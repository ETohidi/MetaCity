// The Twin facade: one clock shared by every level, the three models, and the hand-overs
// between them. Views read through the query methods here and change the twin only through
// tick(), setTime(), setScenario(), addIncident()/clearIncidents(), setMastHealth() and reset().
//
//   Germany (statistics)  --gateway volumes-->  Aachen (hourly model)  --link flows-->  corridor (vehicles)
//   Germany               <--consistency----    Aachen                 <--loop counts--  corridor

import { CORRIDORS, NODE_BY_ID } from "../data/aachen.js";
import { answer, matchQuestion } from "./ask.js";
import { BASE_SCENARIO, CityModel, edgeOf, links } from "./city.js";
import { CorridorSim, corridorConstants, DT } from "./corridor.js";
import * as country from "./country.js";
import { DAY, hhmm } from "./profiles.js";
import { createRng } from "./rng.js";

const CYCLE = 90;
const WAVE_MS = 12.5; // green-wave design speed for direction 0, m/s (45 km/h)

function findLink(a, b) {
  return links.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

/** Corridor geometry: stations (nodes + extra junctions) along x, and the city links it follows. */
export function buildCorridorDef(c) {
  const cityLinks = [];
  let x = 0;
  for (let k = 0; k + 1 < c.nodes.length; k++) {
    const l = findLink(c.nodes[k], c.nodes[k + 1]);
    const len = Math.round(l.km * 1000);
    cityLinks.push({ id: l.id, name: l.name, from: c.nodes[k], to: c.nodes[k + 1], x0: x, x1: x + len });
    x += len;
  }
  const stations = c.nodes.map((n, k) => ({
    name: NODE_BY_ID[n].name,
    x: k === 0 ? 0 : cityLinks[k - 1].x1,
    cityNode: n,
    nodeIndex: k,
  }));
  for (const e of c.extraJunctions) {
    const l = cityLinks[e.link];
    stations.push({ name: e.name, x: Math.round(l.x0 + (l.x1 - l.x0) * e.at), cityNode: null });
  }
  stations.sort((a, b) => a.x - b.x);
  const last = stations.length - 1;
  stations.forEach((s, i) => {
    s.id = `j${i}`;
    s.signal =
      i === 0 || i === last
        ? null
        : { cycle: CYCLE, green: s.cityNode ? 40 : 52, offset: Math.round(s.x / WAVE_MS) % CYCLE };
  });
  return { id: c.id, name: c.name, blurb: c.blurb, nodes: c.nodes, links: cityLinks, stations, length: x };
}

export const corridorDefs = Object.fromEntries(CORRIDORS.map((c) => [c.id, buildCorridorDef(c)]));

export class Twin {
  constructor({ seed = 2026, start = 7.5 * 3600 } = {}) {
    this.seed = seed;
    this.start = start;
    this.city = new CityModel();
    this.country = country;
    this.reset();
  }

  reset() {
    this.rng = createRng(this.seed);
    this.time = this.start;
    this.scenario = { ...BASE_SCENARIO };
    this.carry = 0;
    this.version = 0;
    this.corridors = {};
    for (const def of Object.values(corridorDefs)) this.corridors[def.id] = new CorridorSim(def, this.rng);
    this.restartCorridors();
  }

  restartCorridors() {
    for (const sim of Object.values(this.corridors)) {
      sim.incidents = [];
      sim.reset(this.time, (t) => this.corridorDemand(sim.def, t));
    }
    this.demandMinute = Math.floor(this.time / 60);
  }

  get dayTime() {
    return ((this.time % DAY) + DAY) % DAY;
  }
  get hour() {
    return Math.floor(this.dayTime / 3600);
  }
  get clock() {
    return hhmm(this.dayTime);
  }

  /** Advance the shared clock by dt seconds; the corridors step in fixed DT increments. */
  tick(dt) {
    this.carry += Math.min(dt, 900);
    while (this.carry >= DT) {
      this.carry -= DT;
      this.time += DT;
      const minute = Math.floor(this.time / 60);
      if (minute !== this.demandMinute) {
        this.demandMinute = minute;
        for (const sim of Object.values(this.corridors)) sim.demand = this.corridorDemand(sim.def, this.time);
      }
      for (const sim of Object.values(this.corridors)) sim.step();
    }
  }

  /** Jump to a time of day: the street simulations restart with a short warm-up. */
  setTime(daySeconds) {
    const dayStart = this.time - this.dayTime;
    this.time = dayStart + daySeconds;
    this.restartCorridors();
    this.version++;
  }

  setScenario(patch) {
    this.scenario = { ...this.scenario, ...patch };
    for (const sim of Object.values(this.corridors)) sim.demand = this.corridorDemand(sim.def, this.time);
    this.version++;
  }

  resetScenario() {
    this.setScenario({ ...BASE_SCENARIO });
  }

  addIncident(corridorId, opts) {
    const id = this.corridors[corridorId].addIncident(opts);
    this.version++;
    return id;
  }

  clearIncidents(corridorId) {
    this.corridors[corridorId].incidents = [];
    this.version++;
  }

  setMastHealth(corridorId, station, health) {
    this.corridors[corridorId].health[station] = health;
    this.version++;
  }

  // -- hand-over: city model -> corridor ---------------------------------------------------
  /** Per-direction vehicle rates for a corridor at a time, from the city model's link flows. */
  corridorDemand(def, t) {
    const flows = this.city.flowsAt(((t % DAY) + DAY) % DAY, this.scenario).flow;
    const fwd = def.links.map((l) => flows[edgeOf(l.id, l.from)] || 0);
    const back = def.links.map((l) => flows[edgeOf(l.id, l.to)] || 0);
    const { EXTRA_SIDE_IN, EXTRA_EXIT } = corridorConstants;
    const sides = (d) =>
      def.stations.map((st, i) => {
        if (i === 0 || i === def.stations.length - 1) return { inflow: 0, exit: 0 };
        if (!st.cityNode) return { inflow: EXTRA_SIDE_IN, exit: EXTRA_EXIT };
        const k = st.nodeIndex;
        // Flow into and out of this node along the corridor, in driving direction d.
        const inn = d === 0 ? fwd[k - 1] : back[k];
        const out = d === 0 ? fwd[k] : back[k - 1];
        const delta = out - inn;
        const turnover = 0.15 * inn;
        return { inflow: turnover + Math.max(0, delta), exit: inn > 0 ? Math.min(0.9, (turnover + Math.max(0, -delta)) / inn) : 0 };
      });
    return [
      { entry: fwd[0], side: sides(0) },
      { entry: back[back.length - 1], side: sides(1) },
    ];
  }

  // -- hand-over: corridor -> city (what the street sensors measure vs the model) -------------
  calibration() {
    const flows = this.city.flowsAt(this.dayTime, this.scenario).flow;
    const rows = [];
    for (const sim of Object.values(this.corridors)) {
      const loops = sim.loopFlows();
      sim.def.links.forEach((l, k) => {
        [0, 1].forEach((d) => {
          const model = flows[edgeOf(l.id, d === 0 ? l.from : l.to)];
          const sensed = loops[k][d].vehPerHour;
          rows.push({
            corridor: sim.def.id,
            corridorName: sim.def.name,
            link: l.id,
            name: l.name,
            from: NODE_BY_ID[d === 0 ? l.from : l.to].name,
            to: NODE_BY_ID[d === 0 ? l.to : l.from].name,
            model,
            sensed,
            minutes: loops[k][d].minutes,
            ratio: model > 0 ? sensed / model : null,
          });
        });
      });
    }
    return rows;
  }

  // -- questions ------------------------------------------------------------------------------
  ask(level, qid, params = {}) {
    return answer(this, level, qid, params);
  }

  match(level, text, context = {}) {
    return matchQuestion(this, level, text, context);
  }
}

export { hhmm, DAY };
