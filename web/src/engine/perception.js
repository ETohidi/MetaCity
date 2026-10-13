// What the twin *knows* about events on a corridor, as opposed to what the simulation knows.
// Each sensor mast runs an event classifier set up by text prompts (in the spirit of
// StreetPrompt: classes are sentences, not trained labels), and connected vehicles report
// when they are stuck. Evidence becomes alerts an operator confirms or dismisses.
// An incident the sensors cannot see stays unknown to the twin, and to every answer it gives.
//
// Deterministic: detection chances come from hashFloat, never from the simulation's rng.

import { hashFloat } from "./rng.js";

const EVERY = 5; // seconds between classifier runs
const RAISE_AT = 0.8; // confidence at which evidence becomes an alert
const CLEAR_AFTER = 30; // seconds without evidence before an alert is cleared
const REPORT_MEMORY = 120; // seconds a connected vehicle's hazard warning stays valid
const FALSE_ALARM = 0.0005; // chance per mast and run of a spurious "stalled vehicle"
const SPILLBACK_RUNS = 18; // a long queue must persist this many runs (90 s, a full cycle) to count

/** The class prompts each mast's classifier is set up with. */
export const PROMPTS = {
  stalled: "a stalled or broken-down vehicle blocking a traffic lane",
  spillback: "a queue of stopped cars reaching beyond the camera's view",
  obstructed: "the camera view is blocked, sprayed or turned away",
};

export const SOURCE_LABEL = { mast: "Mast camera classifier", v2x: "Connected-vehicle report" };

/** Combine independent evidence: two 0.7 sources give 0.91. */
const combine = (a, b) => 1 - (1 - a) * (1 - b);

export class Perception {
  constructor(sim) {
    this.sim = sim;
    this.clear();
  }

  clear() {
    this.alerts = [];
    this.nextRun = 0;
    this.nextId = 1;
    this.longQueue = new Map(); // "station|direction" -> consecutive runs with a queue at the edge of view
    this.reporters = new Map(); // incident id -> Map(connected vehicle id -> last report time)
  }

  /** Run the classifiers if it is time; called after every simulation step. */
  step() {
    const sim = this.sim;
    if (sim.time < this.nextRun) return;
    this.nextRun = sim.time + EVERY;
    const run = Math.floor(sim.time / EVERY);
    const obs = [];

    sim.def.stations.forEach((st, i) => {
      if (!st.signal) return;
      const healthy = sim.health[i] === "ok";
      if (!healthy) obs.push({ key: `obstructed|${i}`, kind: "obstructed", station: i, source: "mast", score: 0.93 });

      for (const inc of sim.incidents) {
        if (Math.abs(inc.x - st.x) > 110) continue;
        // A healthy camera sees the blockage most of the time; a tampered one rarely.
        if (hashFloat("cam", inc.id, i, run) < (healthy ? 0.9 : 0.2)) {
          const score = healthy ? 0.84 + 0.12 * hashFloat("conf", inc.id, run) : 0.55;
          obs.push({ key: `stalled|${inc.id}`, kind: "stalled", station: i, source: "mast", score, d: inc.d, lane: inc.lane, x: inc.x, incident: inc.id });
        }
      }

      if (healthy) {
        const m = sim.mast(i);
        // A red light makes long queues every cycle; only one that never clears is a spillback.
        m.queue.forEach((q, d) => {
          const k = `${i}|${d}`;
          const runs = q.metres >= 95 ? (this.longQueue.get(k) ?? 0) + 1 : 0;
          this.longQueue.set(k, runs);
          if (runs >= SPILLBACK_RUNS) obs.push({ key: `spillback|${i}|${d}`, kind: "spillback", station: i, source: "mast", score: 0.82, d });
        });
        if (hashFloat("fp", sim.def.id, i, run) < FALSE_ALARM) {
          const d = hashFloat("fpd", i, run) < 0.5 ? 0 : 1;
          obs.push({ key: `stalled|fp${i}-${run}`, kind: "stalled", station: i, source: "mast", score: 0.81, d, lane: 0, x: st.x + (d === 0 ? -40 : 40), incident: null });
        }
      }
    });

    // Connected vehicles that pass or queue behind a blockage send a hazard warning, wherever the
    // masts are. Reports from different vehicles within two minutes add up.
    for (const inc of sim.incidents) {
      const seen = this.reporters.get(inc.id) ?? new Map();
      for (const v of sim.vehicles()) {
        if (v.cv && v.d === inc.d && Math.abs(sim.xOf(v) - inc.x) < 60) seen.set(v.id, sim.time);
      }
      for (const [id, at] of seen) if (sim.time - at > REPORT_MEMORY) seen.delete(id);
      this.reporters.set(inc.id, seen);
      if (seen.size) {
        const nearest = sim.def.stations.reduce((a, s, i) => (Math.abs(s.x - inc.x) < Math.abs(sim.def.stations[a].x - inc.x) ? i : a), 0);
        const score = 1 - 0.45 ** seen.size; // one report 0.55, two 0.80, three 0.91
        obs.push({ key: `stalled|${inc.id}`, kind: "stalled", station: nearest, source: "v2x", score, d: inc.d, lane: inc.lane, x: inc.x, incident: inc.id });
      }
    }
    for (const id of this.reporters.keys()) if (!sim.incidents.some((i) => i.id === id)) this.reporters.delete(id);

    this.absorb(obs);
  }

  absorb(obs) {
    const now = this.sim.time;
    const byKey = new Map();
    for (const o of obs) {
      const cur = byKey.get(o.key);
      if (!cur) byKey.set(o.key, { ...o, sources: { [o.source]: o.score } });
      else cur.sources[o.source] = Math.max(cur.sources[o.source] ?? 0, o.score);
    }
    for (const [key, o] of byKey) {
      const confidence = Object.values(o.sources).reduce(combine, 0);
      let a = this.alerts.find((x) => x.key === key && x.state !== "cleared");
      if (!a) {
        a = { id: `al${this.nextId++}`, key, kind: o.kind, station: o.station, d: o.d ?? null, lane: o.lane ?? null, x: o.x ?? null, incident: o.incident ?? null, firstSeen: now, raisedAt: null, state: "watching", confidence: 0, sources: {} };
        this.alerts.push(a);
      }
      a.confidence = Math.max(a.confidence * 0.9, confidence);
      for (const [s, v] of Object.entries(o.sources)) a.sources[s] = Math.max(a.sources[s] ?? 0, v);
      a.lastSeen = now;
      if (a.state === "watching" && a.confidence >= RAISE_AT) {
        a.state = "new";
        a.raisedAt = now;
      }
    }
    for (const a of this.alerts) {
      if (a.state !== "cleared" && now - a.lastSeen > CLEAR_AFTER) {
        a.state = a.state === "watching" ? "dropped" : "cleared";
        a.clearedAt = now;
      }
    }
    // Keep the list short: forget old cleared alerts and unraised evidence.
    this.alerts = this.alerts.filter((a) => a.state !== "dropped" && !(a.state === "cleared" && now - a.clearedAt > 600));
  }

  review(id, decision) {
    const a = this.alerts.find((x) => x.id === id);
    if (a && (decision === "confirmed" || decision === "dismissed")) a.state = decision;
  }

  /** Alerts an operator should see: raised and not cleared, newest first. */
  active() {
    return this.alerts.filter((a) => a.state === "new" || a.state === "confirmed").sort((a, b) => b.raisedAt - a.raisedAt);
  }

  /** Recently cleared or dismissed alerts, for the log. */
  recent() {
    return this.alerts.filter((a) => a.state === "cleared" || a.state === "dismissed").sort((a, b) => (b.clearedAt ?? b.raisedAt) - (a.clearedAt ?? a.raisedAt));
  }

  /** True when an incident is known to the twin (raised and not dismissed). */
  knows(incidentId) {
    return this.alerts.some((a) => a.incident === incidentId && (a.state === "new" || a.state === "confirmed"));
  }
}

export { RAISE_AT };
