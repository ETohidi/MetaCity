// Level 3 and 4: one street corridor simulated vehicle by vehicle.
// Two directions with two lanes each; drivers follow the Intelligent Driver Model, stop at
// fixed-time signals, and change lanes only to pass a blocked lane. Demand comes from the
// city model (the hourly link flows at the corridor's ends and side streets), and the
// corridor reports back what its roadside sensors and loop counters measure.
//
// Coordinates: x runs along the corridor from its first node (0) to its last node (L), in
// metres. Direction 0 drives with x, direction 1 against it; each vehicle stores s, the
// distance it has driven from its own entry end (s = x for dir 0, s = L - x for dir 1).

import { hashFloat } from "./rng.js";

export const DT = 0.5; // seconds per simulation step
const LANES = 2;
const STOP_OFFSET = 8; // stop line sits this far before the junction centre
const AMBER = 3;
const MAST_RANGE = 110; // metres a roadside sensor mast sees around its junction
const LOOP_WINDOW_MIN = 15;
const EXTRA_SIDE_IN = 80; // veh/h joining at minor junctions
const EXTRA_EXIT = 0.05; // share leaving at minor junctions

const TYPES = {
  car: { len: 4.5, a: 1.4, b: 2.0, T: 1.2, v0f: 1.0 },
  van: { len: 6, a: 1.2, b: 2.0, T: 1.3, v0f: 0.97 },
  truck: { len: 12, a: 0.7, b: 1.8, T: 1.6, v0f: 0.9 },
  bus: { len: 12, a: 0.9, b: 1.8, T: 1.5, v0f: 0.92 },
};
const TYPE_MIX = { car: 0.86, van: 0.06, truck: 0.04, bus: 0.04 };

export class CorridorSim {
  /**
   * @param def corridor definition ({id, name, stations, links}) prepared by the twin:
   *   stations: [{name, x, signal: {cycle, green, offset} | null, cityNode}]
   *   links: [{id, name, x0, x1}] city links the corridor follows
   */
  constructor(def, rng) {
    this.def = def;
    this.rng = rng;
    this.L = def.length;
    this.speedLimit = 50 / 3.6;
    this.health = def.stations.map(() => "ok");
    this.incidents = [];
    this.demand = null;
    this.nextId = 1;
    this.clear(0);
  }

  clear(time) {
    this.time = time;
    this.lanes = [0, 1].map(() => Array.from({ length: LANES }, () => []));
    this.entryQueue = [0, 0];
    this.sideQueue = [0, 1].map(() => this.def.stations.map(() => 0));
    this.trips = [[], []];
    this.loops = [0, 1].map(() => this.def.links.map(() => new Map()));
    this.loopSince = time;
    this.spilled = [0, 0];
  }

  /** Restart at a time of day and run five minutes of warm-up so the road is not empty. */
  reset(time, demandAt) {
    this.clear(time - 300);
    for (let t = time - 300; t < time; t += DT) {
      if (Math.floor(t) % 60 === 0) this.demand = demandAt(t);
      this.step();
    }
    this.time = time;
  }

  // -- geometry helpers -------------------------------------------------------------
  stationS(i, d) {
    const x = this.def.stations[i].x;
    return d === 0 ? x : this.L - x;
  }
  stopS(i, d) {
    return this.stationS(i, d) - STOP_OFFSET;
  }
  xOf(v) {
    return v.d === 0 ? v.s : this.L - v.s;
  }
  /** Signalised stations in driving order for a direction. */
  signalsAhead(d) {
    const idx = this.def.stations.map((_, i) => i).filter((i) => this.def.stations[i].signal);
    return d === 0 ? idx : idx.reverse();
  }

  // -- signals ------------------------------------------------------------------------
  /** Signal state for the corridor (main road) approach at station i, at time t. */
  signal(i, t = this.time) {
    const sig = this.def.stations[i].signal;
    if (!sig) return null;
    const p = (((t - sig.offset) % sig.cycle) + sig.cycle) % sig.cycle;
    if (p < sig.green) return { state: "green", toChange: sig.green - p, next: "amber", p, ...sig };
    if (p < sig.green + AMBER) return { state: "amber", toChange: sig.green + AMBER - p, next: "red", p, ...sig };
    return { state: "red", toChange: sig.cycle - p, next: "green", p, ...sig };
  }

  // -- step ------------------------------------------------------------------------------
  step() {
    const rng = this.rng;
    this.time += DT;
    const dem = this.demand;
    if (dem) {
      for (const d of [0, 1]) {
        this.entryQueue[d] += arrivals(rng, dem[d].entry * DT / 3600);
        dem[d].side.forEach((side, i) => {
          if (side.inflow > 0) this.sideQueue[d][i] += arrivals(rng, side.inflow * DT / 3600);
        });
      }
    }
    for (const d of [0, 1]) {
      this.admitFromEntry(d);
      this.admitFromSides(d);
      this.changeLanes(d);
    }
    for (const d of [0, 1]) for (const lane of this.lanes[d]) this.move(d, lane);
    for (const d of [0, 1]) this.retire(d);
    for (const inc of this.incidents) if (inc.until !== null && inc.until <= this.time) inc.cleared = true;
    this.incidents = this.incidents.filter((i) => !i.cleared);
  }

  spawn(d, s, lane, v) {
    const rng = this.rng;
    const type = rng.choices(TYPE_MIX);
    const p = TYPES[type];
    const veh = {
      id: this.nextId++,
      d,
      lane,
      s,
      v,
      a: 0,
      type,
      len: p.len,
      amax: p.a,
      b: p.b,
      T: p.T * rng.uniform(0.85, 1.2),
      v0: this.speedLimit * p.v0f * rng.uniform(0.9, 1.08),
      cv: rng.random() < 0.3, // V2X-equipped ("connected") vehicle
      born: this.time,
      pass: {},
      exitAt: this.L + 1,
    };
    // Decide now where it leaves: at each junction ahead it may turn off.
    for (const i of this.order(d)) {
      const at = this.stationS(i, d);
      if (at <= s + 1 || at >= this.L - 1) continue;
      const exitP = this.demand ? this.demand[d].side[i].exit : 0;
      if (rng.random() < exitP) {
        veh.exitAt = at + 4;
        break;
      }
    }
    return veh;
  }

  /** Station indices in driving order. */
  order(d) {
    const idx = this.def.stations.map((_, i) => i);
    return d === 0 ? idx : idx.reverse();
  }

  /** Free room at position s in a lane: gap to the nearest vehicles ahead and behind. */
  room(d, lane, s) {
    let ahead = Infinity;
    let behind = Infinity;
    for (const v of this.lanes[d][lane]) {
      if (v.s - v.len >= s) ahead = Math.min(ahead, v.s - v.len - s);
      else if (v.s <= s) behind = Math.min(behind, s - v.s);
      else return { ahead: -1, behind: -1 };
    }
    for (const inc of this.incidents) {
      if (inc.d === d && inc.lane === lane) {
        const is = inc.d === 0 ? inc.x : this.L - inc.x;
        if (is >= s) ahead = Math.min(ahead, is - s);
      }
    }
    return { ahead, behind };
  }

  insert(veh) {
    const lane = this.lanes[veh.d][veh.lane];
    let i = 0;
    while (i < lane.length && lane[i].s > veh.s) i++;
    lane.splice(i, 0, veh);
  }

  admitFromEntry(d) {
    while (this.entryQueue[d] >= 1) {
      const options = [0, 1].map((lane) => ({ lane, r: this.room(d, lane, 0) })).sort((a, b) => b.r.ahead - a.r.ahead);
      const best = options[0];
      if (best.r.ahead < 9) break;
      const v = Math.min(this.speedLimit * 0.9, Math.max(0, (best.r.ahead - 6) / 2.2));
      const veh = this.spawn(d, 0, best.lane, v);
      veh.pass[this.order(d)[0]] = this.time;
      this.insert(veh);
      this.entryQueue[d] -= 1;
    }
    // A queue that cannot enter backs up beyond the modelled area: count it, cap the backlog.
    if (this.entryQueue[d] > 60) {
      this.spilled[d] += this.entryQueue[d] - 60;
      this.entryQueue[d] = 60;
    }
  }

  admitFromSides(d) {
    this.def.stations.forEach((st, i) => {
      if (this.sideQueue[d][i] < 1) return;
      const s = this.stationS(i, d) + 2;
      if (s <= 1 || s >= this.L - 5) return;
      // Side traffic turns in mostly while the main road has red (its own green).
      const sig = this.signal(i);
      if (sig && sig.state === "green" && this.rng.random() < 0.7) return;
      for (const lane of [1, 0]) {
        const r = this.room(d, lane, s);
        if (r.ahead > 12 && r.behind > 14) {
          const veh = this.spawn(d, s, lane, 4);
          veh.pass[i] = this.time;
          this.insert(veh);
          this.sideQueue[d][i] -= 1;
          return;
        }
      }
      if (this.sideQueue[d][i] > 25) this.sideQueue[d][i] = 25;
    });
  }

  incidentAhead(veh, within) {
    let best = null;
    for (const inc of this.incidents) {
      if (inc.d !== veh.d || inc.lane !== veh.lane) continue;
      const is = inc.d === 0 ? inc.x : this.L - inc.x;
      const gap = is - veh.s;
      if (gap > -1 && gap < within && (!best || gap < best.gap)) best = { inc, gap };
    }
    return best;
  }

  /** Vehicles facing a blocked lane move to the other lane when there is a safe gap. */
  changeLanes(d) {
    for (const lane of [0, 1]) {
      const other = 1 - lane;
      for (const veh of [...this.lanes[d][lane]]) {
        if (!this.incidentAhead(veh, 120)) continue;
        const r = this.room(d, other, veh.s);
        const needAhead = 6 + veh.v * 0.6;
        const needBehind = veh.len + 4 + veh.v * 0.5;
        if (r.ahead > needAhead && r.behind > needBehind && !this.incidentAhead({ ...veh, lane: other }, 60)) {
          const arr = this.lanes[d][lane];
          arr.splice(arr.indexOf(veh), 1);
          veh.lane = other;
          this.insert(veh);
        }
      }
    }
  }

  move(d, lane) {
    const signals = this.signalsAhead(d);
    for (let k = 0; k < lane.length; k++) {
      const veh = lane[k];
      let acc = idm(veh, Infinity, 0);
      const leader = k > 0 ? lane[k - 1] : null;
      if (leader) acc = Math.min(acc, idm(veh, leader.s - leader.len - veh.s, veh.v - leader.v));
      // Next signal ahead within 150 m.
      for (const i of signals) {
        const stop = this.stopS(i, d);
        const gap = stop - veh.s;
        if (gap < -0.5) continue;
        if (gap > 150) break;
        const sig = this.signal(i);
        const mustStop = sig.state === "red" || (sig.state === "amber" && gap > (veh.v * veh.v) / (2 * 3.5));
        if (mustStop) acc = Math.min(acc, idm(veh, Math.max(0.1, gap), veh.v));
        break;
      }
      const blocked = this.incidentAhead(veh, 200);
      if (blocked) acc = Math.min(acc, idm(veh, Math.max(0.1, blocked.gap - 2), veh.v));
      veh.a = Math.max(-9, acc);
    }
    for (const veh of lane) {
      const prev = veh.s;
      const v = Math.max(0, veh.v + veh.a * DT);
      veh.s += Math.max(0, (veh.v + v) * 0.5 * DT);
      veh.v = v;
      this.recordPasses(veh, prev);
    }
  }

  recordPasses(veh, prev) {
    const d = veh.d;
    this.def.stations.forEach((_, i) => {
      const at = this.stationS(i, d);
      if (prev < at && veh.s >= at) veh.pass[i] = this.time;
    });
    this.def.links.forEach((link, k) => {
      const mid = (link.x0 + link.x1) / 2;
      const at = d === 0 ? mid : this.L - mid;
      if (prev < at && veh.s >= at) {
        const minute = Math.floor(this.time / 60);
        const bins = this.loops[d][k];
        bins.set(minute, (bins.get(minute) ?? 0) + 1);
        for (const m of bins.keys()) if (m < minute - LOOP_WINDOW_MIN) bins.delete(m);
      }
    });
  }

  retire(d) {
    for (const lane of this.lanes[d]) {
      for (let k = lane.length - 1; k >= 0; k--) {
        const veh = lane[k];
        if (veh.s >= veh.exitAt || veh.s >= this.L) {
          if (veh.s >= this.L) veh.pass[this.order(d).at(-1)] = this.time;
          lane.splice(k, 1);
          this.trips[d].push({ pass: veh.pass, end: this.time });
          if (this.trips[d].length > 400) this.trips[d].shift();
        }
      }
    }
  }

  // -- events ---------------------------------------------------------------------------------
  addIncident({ d, lane, x, minutes = 20, kind = "Broken-down vehicle" }) {
    const id = `inc${this.nextId++}`;
    this.incidents.push({ id, d, lane, x, kind, since: this.time, until: minutes ? this.time + minutes * 60 : null });
    return id;
  }

  // -- read-only queries (no rng: views and questions must not change the simulation) ----------
  vehicles() {
    const out = [];
    for (const d of [0, 1]) for (const lane of this.lanes[d]) for (const v of lane) out.push(v);
    return out;
  }

  /** What the roadside mast at station i reports right now. */
  mast(i) {
    const st = this.def.stations[i];
    const health = this.health[i];
    const pDetect = health === "ok" ? 0.97 : 0.45;
    const t = Math.floor(this.time);
    const detections = [];
    for (const v of this.vehicles()) {
      const x = this.xOf(v);
      if (Math.abs(x - st.x) > MAST_RANGE) continue;
      if (hashFloat(v.id, i, t) > pDetect) continue;
      const noise = (hashFloat(v.id, i, t, "x") - 0.5) * (health === "ok" ? 0.8 : 4);
      detections.push({ id: v.id, d: v.d, lane: v.lane, x: x + noise, kmh: v.v * 3.6, type: v.type, cv: v.cv, len: v.len });
    }
    const queue = [0, 1].map((d) => {
      const stop = st.signal ? this.stopS(i, d) : null;
      if (stop === null) return { vehicles: 0, metres: 0 };
      const stopX = d === 0 ? stop : this.L - stop;
      const waiting = detections.filter((v) => v.d === d && v.kmh < 7 && (d === 0 ? v.x <= stopX + 1 : v.x >= stopX - 1));
      const metres = waiting.reduce((m, v) => Math.max(m, Math.abs(stopX - v.x) + v.len), 0);
      return { vehicles: waiting.length, metres };
    });
    const speeds = detections.map((v) => v.kmh);
    const meanKmh = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
    return { station: i, name: st.name, health, range: MAST_RANGE, detections, queue, meanKmh, cpmPerSecond: detections.length > 0 ? 10 : 0 };
  }

  /** Loop-counter flow on each corridor link and direction (veh/h), over the last 15 minutes. */
  loopFlows() {
    const minute = Math.floor(this.time / 60);
    const span = Math.max(1, Math.min(LOOP_WINDOW_MIN, (this.time - this.loopSince) / 60));
    return this.def.links.map((link, k) =>
      [0, 1].map((d) => {
        let n = 0;
        for (const [m, c] of this.loops[d][k]) if (m > minute - LOOP_WINDOW_MIN && m <= minute) n += c;
        return { vehPerHour: (n * 60) / span, minutes: span };
      }),
    );
  }

  /**
   * Measured travel time between stations i and j (direction from their order), from vehicles
   * that passed both in the last 15 minutes. Falls back to a free-flow-plus-signals estimate.
   */
  travelTime(i, j) {
    const d = i < j ? 0 : 1;
    const samples = [];
    const cutoff = this.time - 15 * 60;
    for (const trip of this.trips[d]) {
      if (trip.end < cutoff) continue;
      if (trip.pass[i] !== undefined && trip.pass[j] !== undefined) samples.push(trip.pass[j] - trip.pass[i]);
    }
    for (const v of this.vehicles()) {
      if (v.d === d && v.pass[i] !== undefined && v.pass[j] !== undefined && v.pass[j] >= cutoff) samples.push(v.pass[j] - v.pass[i]);
    }
    const dist = Math.abs(this.def.stations[j].x - this.def.stations[i].x);
    if (samples.length >= 3) {
      samples.sort((a, b) => a - b);
      return { seconds: samples[Math.floor(samples.length / 2)], samples: samples.length, method: "measured", metres: dist, d };
    }
    // Estimate: free flow plus the average red-light wait at every signal passed on the way.
    let seconds = dist / (this.speedLimit * 0.9);
    for (let k = Math.min(i, j); k <= Math.max(i, j); k++) {
      const sig = this.def.stations[k].signal;
      if (k !== i && sig) seconds += (sig.cycle - sig.green) ** 2 / (2 * sig.cycle);
    }
    return { seconds, samples: samples.length, method: "estimated", metres: dist, d };
  }

  /** Mean speed of all vehicles in one direction (km/h), and how many there are. */
  directionStats(d) {
    const vs = this.lanes[d].flat();
    const mean = vs.length ? (vs.reduce((n, v) => n + v.v, 0) / vs.length) * 3.6 : null;
    const stopped = vs.filter((v) => v.v < 1).length;
    return { vehicles: vs.length, meanKmh: mean, stopped, waitingToEnter: Math.floor(this.entryQueue[d]) };
  }

  /** Recommended speed to arrive on green at station i from `metres` away (GLOSA). */
  greenSpeed(i, metres) {
    const now = this.signal(i);
    if (!now) return null;
    for (let kmh = 50; kmh >= 20; kmh -= 1) {
      const t = this.time + metres / (kmh / 3.6);
      if (this.signal(i, t).state === "green") return { kmh, arriveIn: metres / (kmh / 3.6) };
    }
    return { kmh: null };
  }
}

/** Intelligent Driver Model acceleration. */
function idm(veh, gap, dv) {
  const free = 1 - (veh.v / veh.v0) ** 4;
  if (!Number.isFinite(gap)) return veh.amax * free;
  const sStar = 2 + Math.max(0, veh.v * veh.T + (veh.v * dv) / (2 * Math.sqrt(veh.amax * veh.b)));
  return veh.amax * (free - (sStar / Math.max(gap, 0.1)) ** 2);
}

/** Whole arrivals in one step for an expected count `mean` (small), kept unbiased. */
function arrivals(rng, mean) {
  const whole = Math.floor(mean);
  return whole + (rng.random() < mean - whole ? 1 : 0);
}

export const corridorConstants = { EXTRA_SIDE_IN, EXTRA_EXIT, MAST_RANGE, STOP_OFFSET, LANES };
