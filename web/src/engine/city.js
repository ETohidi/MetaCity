// Level 2: the city twin. A classic macroscopic ("four-step") model on the schematic Aachen
// network: trips from population and jobs (gravity model), spread over the day with a
// weekday profile, and assigned to roads hour by hour with volume-delay functions.
// Its edges take traffic from the country level (motorway gateways), and it hands hourly
// link flows down to the street-level simulations.

import { GATEWAYS, LINKS, NODES, ROAD_CLASS, ZONES } from "../data/aachen.js";
import { SEG_BY_ID } from "./country.js";
import { co2Kg } from "./emissions.js";
import { haversineKm } from "./geo.js";
import { OUTBOUND_SHARE, URBAN_PROFILE } from "./profiles.js";

const DETOUR = 1.1;
const CAR_TRIPS_PER_RESIDENT = 0.42; // home-based car trips leaving home per resident and day
const GRAVITY_BETA = 0.09; // per minute of travel time
const MSA_ITERATIONS = 14;
const BPR_BETA = 4;

export const BASE_SCENARIO = Object.freeze({ closed: [], busLanes: [], zone30: false, demand: 1 });

export const scenarioKey = (s) =>
  [[...s.closed].sort().join(","), [...s.busLanes].sort().join(","), s.zone30 ? 1 : 0, s.demand.toFixed(3)].join("|");

export const nodeIndex = Object.fromEntries(NODES.map((n, i) => [n.id, i]));

/** Links with geometry; each undirected link is two directed edges: 2i (from→to) and 2i+1 (to→from). */
export const links = LINKS.map((l, i) => {
  const a = NODES[nodeIndex[l.from]];
  const b = NODES[nodeIndex[l.to]];
  const km = haversineKm(a, b) * DETOUR;
  return { ...l, index: i, km, ...ROAD_CLASS[l.cls] };
});
export const LINK_INDEX = Object.fromEntries(links.map((l) => [l.id, l.index]));

export const edgeFrom = (e) => (e % 2 === 0 ? links[e >> 1].from : links[e >> 1].to);
export const edgeTo = (e) => (e % 2 === 0 ? links[e >> 1].to : links[e >> 1].from);
/** Directed edge of a link that leaves node `from`. */
export const edgeOf = (linkId, from) => {
  const l = links[LINK_INDEX[linkId]];
  return 2 * l.index + (l.from === from ? 0 : 1);
};

const EDGES = links.length * 2;
const outEdges = NODES.map(() => []);
for (let e = 0; e < EDGES; e++) outEdges[nodeIndex[edgeFrom(e)]].push(e);

// Inside the Alleenring: the area a 30 km/h zone would cover.
const ZONE30 = new Set(links.filter((l) => l.cls === "inner" || l.cls === "ring").map((l) => l.id));

/** Per-edge supply for a scenario: capacity and free-flow minutes (Infinity when closed). */
function supply(scenario) {
  const closed = new Set(scenario.closed);
  const bus = new Set(scenario.busLanes);
  const cap = new Float64Array(EDGES);
  const t0 = new Float64Array(EDGES);
  const kmh = new Float64Array(EDGES);
  for (const l of links) {
    let c = l.cap;
    let v = l.kmh;
    if (bus.has(l.id)) c *= 0.5; // one of two lanes given to buses
    if (scenario.zone30 && ZONE30.has(l.id)) {
      v = Math.min(v, 30);
      c *= 0.9;
    }
    for (const e of [2 * l.index, 2 * l.index + 1]) {
      cap[e] = c;
      kmh[e] = v;
      t0[e] = closed.has(l.id) ? Infinity : (l.km / v) * 60;
    }
  }
  return { cap, t0, kmh };
}

/** Shortest-path tree from one node: previous edge per node and distances (minutes). */
function shortestPaths(origin, cost) {
  const n = NODES.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[origin] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = 1;
    for (const e of outEdges[u]) {
      const v = nodeIndex[edgeTo(e)];
      const d = dist[u] + cost[e];
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = e;
      }
    }
  }
  return { dist, prev };
}

function pathEdges(tree, dest) {
  const edges = [];
  let v = dest;
  while (tree.prev[v] >= 0) {
    const e = tree.prev[v];
    edges.push(e);
    v = nodeIndex[edgeFrom(e)];
  }
  return edges.reverse();
}

// -- demand ----------------------------------------------------------------------
// Daily home-based trips T[o][d] (one way, leaving home). Built once from free-flow times
// on the base network, so a scenario changes routes (and the demand factor) but not where
// people live and work: a fair short-term "what if".
/** A zone's loading points: the centre's traffic uses the parking garages on the ring. */
const zoneNodes = (z) => (z.nodes ?? [z.node]).map((n) => nodeIndex[n]);

function buildDailyDemand() {
  const base = supply(BASE_SCENARIO);
  const trips = []; // {o, d, perDay, kind}
  /** Spread a zone-to-zone volume evenly over the zones' loading points. */
  const add = (os, ds, perDay, kind) => {
    const pairs = os.flatMap((o) => ds.filter((d) => d !== o).map((d) => [o, d]));
    for (const [o, d] of pairs) trips.push({ o, d, perDay: perDay / pairs.length, kind });
  };
  const attraction = ZONES.map((z) => z.jobs + 0.5 * z.pop);
  for (const zo of ZONES) {
    const tree = shortestPaths(zoneNodes(zo)[0], base.t0);
    const weights = ZONES.map((zd, j) =>
      zd === zo ? 0 : attraction[j] * Math.exp(-GRAVITY_BETA * Math.min(...zoneNodes(zd).map((n) => tree.dist[n]))),
    );
    const total = weights.reduce((a, b) => a + b, 0);
    const produced = zo.pop * CAR_TRIPS_PER_RESIDENT;
    ZONES.forEach((zd, j) => {
      if (weights[j] > 0) add(zoneNodes(zo), zoneNodes(zd), (produced * weights[j]) / total, "local");
    });
  }
  // Gateways: commuters and visitors from outside, plus through traffic between gateways.
  const jobsTotal = ZONES.reduce((n, z) => n + z.jobs + 0.3 * z.pop, 0);
  const gatewayDaily = {};
  for (const g of GATEWAYS) {
    const seg = g.segment ? SEG_BY_ID[g.segment] : null;
    const daily = seg ? seg.aadt / 2 : g.daily;
    gatewayDaily[g.node] = { daily, segment: g.segment ?? null };
    const o = nodeIndex[g.node];
    for (const z of ZONES) add([o], zoneNodes(z), (daily * g.toCity * (z.jobs + 0.3 * z.pop)) / jobsTotal, "inbound");
    for (const [other, share] of Object.entries(g.through ?? {})) {
      // Through trips are counted once per direction from each end, so halve them here.
      add([o], [nodeIndex[other]], (daily * (1 - g.toCity) * share) / 2, "through");
    }
  }
  return { trips, gatewayDaily };
}

const DAILY = buildDailyDemand();

/** Vehicles per hour from o to d in a given hour (outbound share applied to both directions). */
function hourlyOd(hour, factor) {
  const out = OUTBOUND_SHARE[hour];
  const p = URBAN_PROFILE[hour] * 2 * factor; // *2: every one-way trip has a return trip
  const od = new Map();
  const add = (o, d, q, kind) => {
    const key = o * 1000 + d;
    const cur = od.get(key);
    if (cur) cur.q += q;
    else od.set(key, { o, d, q, kind });
  };
  for (const t of DAILY.trips) {
    if (t.kind === "through") {
      add(t.o, t.d, t.perDay * p * 0.5, t.kind);
      add(t.d, t.o, t.perDay * p * 0.5, t.kind);
    } else {
      add(t.o, t.d, t.perDay * p * out, t.kind);
      add(t.d, t.o, t.perDay * p * (1 - out), t.kind);
    }
  }
  return [...od.values()];
}

// -- assignment --------------------------------------------------------------------
function bprMinutes(t0, flow, cap, alpha) {
  return t0 * (1 + alpha * (flow / cap) ** BPR_BETA);
}

function assignHour(hour, scenario) {
  const { cap, t0, kmh } = supply(scenario);
  const alpha = new Float64Array(EDGES).map((_, e) => links[e >> 1].alpha);
  const od = hourlyOd(hour, scenario.demand);
  const byOrigin = new Map();
  for (const r of od) {
    if (!byOrigin.has(r.o)) byOrigin.set(r.o, []);
    byOrigin.get(r.o).push(r);
  }
  const flow = new Float64Array(EDGES);
  const through = new Float64Array(EDGES);
  const cost = new Float64Array(EDGES);
  let unserved = 0;
  for (let k = 1; k <= MSA_ITERATIONS; k++) {
    for (let e = 0; e < EDGES; e++) cost[e] = bprMinutes(t0[e], flow[e], cap[e], alpha[e]);
    const aon = new Float64Array(EDGES);
    const aonThrough = new Float64Array(EDGES);
    let lost = 0;
    for (const [o, rows] of byOrigin) {
      const tree = shortestPaths(o, cost);
      for (const r of rows) {
        if (!Number.isFinite(tree.dist[r.d])) {
          lost += r.q;
          continue;
        }
        for (const e of pathEdges(tree, r.d)) {
          aon[e] += r.q;
          if (r.kind === "through") aonThrough[e] += r.q;
        }
      }
    }
    for (let e = 0; e < EDGES; e++) {
      flow[e] += (aon[e] - flow[e]) / k;
      through[e] += (aonThrough[e] - through[e]) / k;
    }
    unserved = lost;
  }
  const minutes = new Float64Array(EDGES);
  const speed = new Float64Array(EDGES);
  const vc = new Float64Array(EDGES);
  let vkt = 0;
  let vht = 0;
  let freeVht = 0;
  let co2 = 0;
  for (let e = 0; e < EDGES; e++) {
    const l = links[e >> 1];
    if (!Number.isFinite(t0[e])) {
      minutes[e] = Infinity;
      continue;
    }
    minutes[e] = bprMinutes(t0[e], flow[e], cap[e], alpha[e]);
    speed[e] = (l.km / minutes[e]) * 60;
    vc[e] = flow[e] / cap[e];
    vkt += flow[e] * l.km;
    vht += (flow[e] * minutes[e]) / 60;
    freeVht += (flow[e] * t0[e]) / 60;
    co2 += co2Kg(flow[e] * l.km, speed[e], l.hgv);
  }
  const trips = od.reduce((n, r) => n + r.q, 0);
  return { hour, flow, through, minutes, speed, vc, kmhLimit: kmh, totals: { trips, vkt, vht, delayH: vht - freeVht, co2Kg: co2, unserved } };
}

// -- the model ----------------------------------------------------------------------
export class CityModel {
  constructor() {
    this.cache = new Map();
    this.gatewayDaily = DAILY.gatewayDaily;
  }

  /** Assignment for one whole hour (cached per scenario). */
  hour(hour, scenario = BASE_SCENARIO) {
    const h = ((hour % 24) + 24) % 24;
    const key = `${h}#${scenarioKey(scenario)}`;
    if (!this.cache.has(key)) {
      if (this.cache.size > 400) this.cache.clear();
      this.cache.set(key, assignHour(h, scenario));
    }
    return this.cache.get(key);
  }

  /** Edge flows at a moment, blended between the two neighbouring hours (centred on :30). */
  flowsAt(timeSec, scenario = BASE_SCENARIO) {
    const x = timeSec / 3600 - 0.5;
    const h0 = Math.floor(x);
    const w = x - h0;
    const a = this.hour(h0, scenario);
    const b = this.hour(h0 + 1, scenario);
    const mix = (p, q) => p.map((v, i) => (Number.isFinite(v) && Number.isFinite(q[i]) ? v * (1 - w) + q[i] * w : v));
    return { flow: mix(a.flow, b.flow), vc: mix(a.vc, b.vc), speed: mix(a.speed, b.speed), minutes: mix(a.minutes, b.minutes) };
  }

  /** 24 hourly results and whole-day totals. */
  day(scenario = BASE_SCENARIO) {
    const hours = Array.from({ length: 24 }, (_, h) => this.hour(h, scenario));
    const totals = { trips: 0, vkt: 0, vht: 0, delayH: 0, co2Kg: 0, unserved: 0 };
    for (const r of hours) for (const k of Object.keys(totals)) totals[k] += r.totals[k];
    const linkDaily = new Float64Array(EDGES);
    for (const r of hours) for (let e = 0; e < EDGES; e++) linkDaily[e] += r.flow[e];
    return { hours, totals, linkDaily };
  }

  /** Travel time in minutes along a node path at an hour (Infinity when a link is closed). */
  pathMinutes(nodeIds, hour, scenario = BASE_SCENARIO) {
    const r = this.hour(hour, scenario);
    let m = 0;
    for (let i = 0; i + 1 < nodeIds.length; i++) {
      const link = links.find((l) => (l.from === nodeIds[i] && l.to === nodeIds[i + 1]) || (l.to === nodeIds[i] && l.from === nodeIds[i + 1]));
      m += r.minutes[edgeOf(link.id, nodeIds[i])];
    }
    return m;
  }

  /** Fastest route between two nodes at an hour. */
  route(fromId, toId, hour, scenario = BASE_SCENARIO) {
    const r = this.hour(hour, scenario);
    const tree = shortestPaths(nodeIndex[fromId], r.minutes);
    const edges = pathEdges(tree, nodeIndex[toId]);
    return { minutes: tree.dist[nodeIndex[toId]], edges, km: edges.reduce((n, e) => n + links[e >> 1].km, 0) };
  }
}

export const EDGE_COUNT = EDGES;
export { ZONE30 };

/** Vehicle trips per day by kind: inside Aachen, to/from outside, and through traffic. */
export function demandSummary() {
  const byKind = { local: 0, inbound: 0, through: 0 };
  for (const t of DAILY.trips) byKind[t.kind] += t.perDay * 2; // every trip comes back
  return byKind;
}

/** The boundary link at each gateway node, where the city model meets the country model. */
export const gatewayLinks = Object.fromEntries(
  GATEWAYS.map((g) => [g.node, links.find((l) => l.from === g.node || l.to === g.node)]),
);
