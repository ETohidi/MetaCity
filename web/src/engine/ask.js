// "Ask the twin": rule-based questions per level, answered from the models. No LLM.
// Each level speaks to a different person: the federal planner (Germany), the municipal
// planner (Aachen) and the driver (a corridor). Every answer says which level and which
// data it comes from, so the reader knows how precise it is.
//
// An answer: { question, headline, body[], facts[[label, value]], table?{head, rows},
//              series?{label, unit, values, mark}, basis{level, data, resolution, confidence},
//              highlight{segments[], links[], stations[]}, apply?{city scenario}, time }

import { LINKS, NODE_BY_ID } from "../data/aachen.js";
import { demandSummary, edgeOf, gatewayLinks, links, LINK_INDEX, ZONE30 } from "./city.js";
import { countryYear, segments, SEG_BY_ID, segmentHour, segmentsAt } from "./country.js";
import { DAY, hhmm } from "./profiles.js";

// -- formatting (engine-side, locale-independent) ------------------------------------------
const int = (n) => Math.round(n).toLocaleString("en-US");
const pct = (x) => `${Math.round(x * 100)}%`;
const signed = (n, unit = "") => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${int(Math.abs(n))}${unit}`;
const signedPct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${(Math.abs(x) * 100).toFixed(1)}%`;
const mins = (s) => (s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const hourLabel = (h) => `${String(h).padStart(2, "0")}:00`;

const BASIS = {
  country: {
    level: "Germany",
    data: "Annual average daily traffic per motorway segment, spread over a typical weekday",
    resolution: "Segment (50–300 km), hourly profile",
    confidence: "Rough (±25%): statistics, not observations",
  },
  city: {
    level: "Aachen",
    data: "Hourly macroscopic model: gravity demand from population and jobs, assigned to roads",
    resolution: "Road link (1–8 km), one hour",
    confidence: "Moderate (±15%): checked against corridor sensors",
  },
  corridor: {
    level: "Street corridor",
    data: "Vehicle-by-vehicle simulation, observed by roadside sensor masts and loop counters",
    resolution: "Single vehicle, half a second",
    confidence: "High while the sensors are healthy",
  },
};

export const ROLES = {
  country: "Federal transport planner",
  city: "Municipal traffic planner",
  corridor: "Driver",
};

const ROADS = [...new Set(segments.map((s) => s.road))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const linkOptions = () => LINKS.filter((l) => l.cls !== "motorway").map((l) => ({ value: l.id, label: `${l.name} (${NODE_BY_ID[l.from].name} – ${NODE_BY_ID[l.to].name})` }));
const hourOptions = () => Array.from({ length: 24 }, (_, h) => ({ value: h, label: hourLabel(h) }));
const stationOptions = (twin, ctx) => twin.corridors[ctx.corridor].def.stations.map((s, i) => ({ value: i, label: s.name }));
const signalOptions = (twin, ctx) =>
  twin.corridors[ctx.corridor].def.stations.map((s, i) => ({ value: i, label: s.name, signal: !!s.signal })).filter((o) => o.signal);

/**
 * The question catalogue. `params` describe the form the view shows; `defaults(twin, ctx)` fills
 * it; `keywords` drive free-text matching.
 */
export const QUESTIONS = {
  country: [
    { id: "busiest", text: "Which motorway corridors are the most congested?", keywords: ["congest", "busiest", "jam", "stau", "capacity", "bottleneck", "worst", "load"] },
    { id: "freight", text: "Where does freight traffic concentrate?", keywords: ["freight", "truck", "lorry", "hgv", "lkw", "goods", "logistic"] },
    { id: "co2", text: "How much CO2 do motorways emit per year?", keywords: ["co2", "emission", "climate", "carbon", "pollut"] },
    {
      id: "growth",
      text: "What if traffic grows by {growth}% by 2035?",
      keywords: ["grow", "growth", "increase", "2030", "2035", "2040", "future", "forecast", "more traffic"],
      params: [{ key: "growth", label: "Growth", options: () => [5, 10, 15, 20, 30].map((v) => ({ value: v, label: `${v}%` })) }],
      defaults: () => ({ growth: 15 }),
    },
    {
      id: "rail",
      text: "What if {share}% of trucks on {road} shift to rail?",
      keywords: ["rail", "by rail", "to rail", "train", "shift", "modal", "bahn"],
      params: [
        { key: "share", label: "Share", options: () => [10, 20, 30, 50].map((v) => ({ value: v, label: `${v}%` })) },
        { key: "road", label: "Motorway", options: () => [{ value: "all", label: "all motorways" }, ...ROADS.map((r) => ({ value: r, label: r }))] },
      ],
      defaults: () => ({ share: 20, road: "all" }),
    },
    {
      id: "limit",
      text: "What would a {limit} km/h speed limit change?",
      keywords: ["speed limit", "tempolimit", "limit", "130", "120", "speed"],
      params: [{ key: "limit", label: "Limit", options: () => [100, 120, 130].map((v) => ({ value: v, label: `${v} km/h` })) }],
      defaults: () => ({ limit: 130 }),
    },
    { id: "aachen", text: "How does the Aachen region connect to the network?", keywords: ["aachen", "border", "region", "city", "connect", "netherlands", "belgium"] },
  ],
  city: [
    {
      id: "bottlenecks",
      text: "Where are the bottlenecks at {hour}?",
      keywords: ["bottleneck", "congest", "jam", "stau", "where", "worst", "busy", "slow"],
      params: [{ key: "hour", label: "Hour", options: hourOptions }],
      defaults: (twin) => ({ hour: twin.hour }),
    },
    {
      id: "closure",
      text: "What if we close {link} for roadworks?",
      keywords: ["close", "closure", "roadwork", "construction", "baustelle", "block", "shut"],
      params: [{ key: "link", label: "Road", options: linkOptions }],
      defaults: () => ({ link: "jul1" }),
    },
    {
      id: "buslane",
      text: "What if {link} gets a bus lane?",
      keywords: ["bus lane", "bus", "busspur", "transit lane", "lane"],
      params: [{ key: "link", label: "Road", options: linkOptions }],
      defaults: () => ({ link: "ring2" }),
    },
    { id: "zone30", text: "What does a 30 km/h zone inside the Alleenring change?", keywords: ["30", "tempo 30", "zone", "speed", "slow zone", "center", "centre", "old town"] },
    {
      id: "demand",
      text: "What if car traffic drops by {pct}%?",
      keywords: ["drop", "fewer", "less", "reduce", "home office", "remote", "shift", "bike", "transit", "decrease"],
      params: [{ key: "pct", label: "Drop", options: () => [5, 10, 20, 30].map((v) => ({ value: v, label: `${v}%` })) }],
      defaults: () => ({ pct: 10 }),
    },
    { id: "outside", text: "How much traffic comes from outside Aachen?", keywords: ["outside", "commut", "through", "external", "pendler", "region", "incoming"] },
    { id: "daily", text: "How many km are driven and how much CO2 per day?", keywords: ["km", "kilometre", "kilometer", "co2", "emission", "total", "per day", "daily", "climate"] },
    { id: "peak", text: "When is the peak hour?", keywords: ["peak", "rush", "hour", "when", "busiest time", "time of day"] },
    { id: "calibration", text: "How well does the model match the street sensors?", keywords: ["sensor", "calibrat", "accura", "match", "valid", "measure", "count", "loop"] },
  ],
  corridor: [
    {
      id: "traveltime",
      text: "How long from {from} to {to} right now?",
      keywords: ["how long", "travel time", "time", "minutes", "get to", "drive to", "eta", "duration"],
      params: [
        { key: "from", label: "From", options: stationOptions },
        { key: "to", label: "To", options: stationOptions },
      ],
      defaults: (twin, ctx) => ({ from: 0, to: twin.corridors[ctx.corridor].def.stations.length - 1 }),
    },
    {
      id: "green",
      text: "When does the light at {junction} turn green? I am {dist} away.",
      keywords: ["light", "green", "signal", "red", "ampel", "traffic light", "glosa", "speed"],
      params: [
        { key: "junction", label: "Junction", options: signalOptions },
        { key: "dist", label: "Distance", options: () => [80, 150, 250, 400].map((v) => ({ value: v, label: `${v} m` })) },
      ],
      defaults: (twin, ctx) => ({ junction: signalOptions(twin, ctx)[0].value, dist: 250 }),
    },
    {
      id: "queue",
      text: "How long is the queue at {junction}?",
      keywords: ["queue", "waiting", "line", "backed up", "stau", "cars waiting"],
      params: [{ key: "junction", label: "Junction", options: signalOptions }],
      defaults: (twin, ctx) => ({ junction: signalOptions(twin, ctx)[0].value }),
    },
    { id: "ahead", text: "Is anything blocking the road?", keywords: ["block", "accident", "incident", "crash", "broken", "obstacle", "ahead", "problem", "clear"] },
    {
      id: "leave",
      text: "Should I leave now or later to get from {from} to {to}?",
      keywords: ["leave", "later", "depart", "wait", "when should", "best time", "now or"],
      params: [
        { key: "from", label: "From", options: stationOptions },
        { key: "to", label: "To", options: stationOptions },
      ],
      defaults: (twin, ctx) => ({ from: twin.corridors[ctx.corridor].def.stations.length - 1, to: 0 }),
    },
  ],
};

/** The question text with its parameters filled in, using the option labels. */
export function questionText(twin, level, qid, params, ctx = {}) {
  const q = QUESTIONS[level].find((x) => x.id === qid);
  return q.text.replace(/\{(\w+)\}/g, (_, key) => {
    const p = q.params?.find((x) => x.key === key);
    const opt = p?.options(twin, ctx).find((o) => String(o.value) === String(params[key]));
    return opt ? opt.label : String(params[key] ?? key);
  });
}

// -- shared helpers ---------------------------------------------------------------------------
const linkName = (id) => {
  const l = links[LINK_INDEX[id]];
  return `${l.name} (${NODE_BY_ID[l.from].name} – ${NODE_BY_ID[l.to].name})`;
};
const edgeLabel = (e) => {
  const l = links[e >> 1];
  const [a, b] = e % 2 === 0 ? [l.from, l.to] : [l.to, l.from];
  return `${l.name}, ${NODE_BY_ID[a].name} → ${NODE_BY_ID[b].name}`;
};

/** City what-if: compare the active scenario with a variant over the whole day and the peak hour. */
function compareCity(twin, variant, title) {
  const base = twin.city.day(twin.scenario);
  const alt = twin.city.day(variant);
  const peakH = 8;
  const b8 = base.hours[peakH];
  const a8 = alt.hours[peakH];
  const changes = [];
  for (let e = 0; e < b8.flow.length; e++) {
    const df = a8.flow[e] - b8.flow[e];
    if (Number.isFinite(df)) changes.push({ e, df, from: b8.flow[e], to: a8.flow[e], vc: a8.vc[e] });
  }
  changes.sort((x, y) => y.df - x.df);
  const gainers = changes.filter((c) => c.df > 30).slice(0, 5);
  const relief = [...changes].sort((x, y) => x.df - y.df).filter((c) => c.df < -30).slice(0, 3);
  const dV = alt.totals.vht - base.totals.vht;
  const dDelay = alt.totals.delayH - base.totals.delayH;
  const dKm = alt.totals.vkt - base.totals.vkt;
  const dCo2 = alt.totals.co2Kg - base.totals.co2Kg;
  const worse = dV > 0;
  return {
    apply: variant,
    headline: `${title}: ${worse ? "the network loses" : "the network saves"} about ${int(Math.abs(dV))} vehicle-hours a day (${signedPct(dV / base.totals.vht)}).`,
    body: [
      gainers.length
        ? `At 08:00 the traffic moves mostly onto ${gainers.slice(0, 2).map((g) => edgeLabel(g.e)).join(" and ")}.`
        : "No street picks up much extra traffic at 08:00.",
      alt.totals.unserved > 1 ? `${int(alt.totals.unserved)} vehicle trips a day have no route left.` : null,
      "Short-term effect: routes change, but where people live and work does not.",
    ].filter(Boolean),
    facts: [
      ["Time in traffic", `${signed(dV, " veh-h/day")}`],
      ["Delay (vs free flow)", `${signed(dDelay, " veh-h/day")}`],
      ["Distance driven", `${signed(dKm, " veh-km/day")}`],
      ["CO2", `${signed(dCo2 / 1000, " t/day")}`],
    ],
    table: {
      head: ["Street at 08:00", "Before", "After", "Load"],
      rows: [...gainers, ...relief].map((c) => [edgeLabel(c.e), `${int(c.from)}/h`, `${int(c.to)}/h`, pct(c.vc)]),
    },
    highlight: { links: [...new Set(gainers.map((g) => links[g.e >> 1].id))] },
  };
}

/** City-model minutes for the part of a corridor between stations i and j, at time t. */
function cityMinutesAlong(twin, sim, i, j, t) {
  const def = sim.def;
  const d = i < j ? 0 : 1;
  const x0 = Math.min(def.stations[i].x, def.stations[j].x);
  const x1 = Math.max(def.stations[i].x, def.stations[j].x);
  const r = twin.city.flowsAt(((t % DAY) + DAY) % DAY, twin.scenario);
  let m = 0;
  for (const l of def.links) {
    const overlap = Math.max(0, Math.min(x1, l.x1) - Math.max(x0, l.x0));
    if (overlap <= 0) continue;
    const e = edgeOf(l.id, d === 0 ? l.from : l.to);
    m += r.minutes[e] * (overlap / (l.x1 - l.x0));
  }
  return m;
}

// -- answers ------------------------------------------------------------------------------------
const ANSWERS = {
  country: {
    busiest(twin) {
      const year = countryYear();
      const top = [...year.rows].sort((a, b) => b.peakVc - a.peakVc).slice(0, 6);
      const h = twin.hour;
      const now = segments.map((s) => ({ s, ...segmentHour(s, h) })).sort((a, b) => b.vc - a.vc)[0];
      return {
        headline: `${top[0].seg.name} is the most loaded corridor: at ${hourLabel(top[0].peakHour)} demand reaches ${pct(top[0].peakVc)} of capacity.`,
        body: [
          `Right now (${twin.clock}) the most loaded segment is ${now.s.name} at ${pct(now.vc)} of capacity, about ${int(now.kmh)} km/h.`,
          `${year.overCapacity} segment${year.overCapacity === 1 ? "" : "s"} exceed capacity in the peak hour on a typical weekday.`,
        ],
        table: {
          head: ["Segment", "Vehicles/day", "Peak load", "Congested h/year"],
          rows: top.map((r) => [r.seg.name, int(r.aadt), pct(r.peakVc), int(r.congestedHoursPerYear)]),
        },
        highlight: { segments: top.map((r) => r.seg.id) },
      };
    },
    freight() {
      const year = countryYear();
      const top = [...year.rows].sort((a, b) => b.hgvPerDay - a.hgvPerDay).slice(0, 6);
      return {
        headline: `Freight concentrates on ${top[0].seg.name} with about ${int(top[0].hgvPerDay)} heavy goods vehicles a day (${pct(top[0].seg.hgv)} of its traffic).`,
        body: [
          `Across the modelled motorways trucks drive about ${int(year.hgvKmPerDay / 1e6 * 10) / 10} million km a day. The east–west axes (A2) carry the highest truck shares.`,
        ],
        table: {
          head: ["Segment", "Trucks/day", "Truck share", "Lanes"],
          rows: top.map((r) => [r.seg.name, int(r.hgvPerDay), pct(r.seg.hgv), `${r.seg.lanes}+${r.seg.lanes}`]),
        },
        highlight: { segments: top.map((r) => r.seg.id) },
      };
    },
    co2() {
      const year = countryYear();
      const top = [...year.rows].sort((a, b) => b.co2TonnesPerYear - a.co2TonnesPerYear).slice(0, 5);
      return {
        headline: `The modelled motorways emit about ${(year.co2TonnesPerYear / 1e6).toFixed(1)} million tonnes of CO2 a year.`,
        body: [
          `That is ${int(year.vktPerYear / 1e9)} billion vehicle-km. The largest single emitter is ${top[0].seg.name} (${int(top[0].co2TonnesPerYear / 1000)} kt): long, busy and truck-heavy.`,
          "Only the motorway segments in this model are counted, not the whole road network.",
        ],
        table: {
          head: ["Segment", "CO2 kt/year", "Length", "Vehicles/day"],
          rows: top.map((r) => [r.seg.name, int(r.co2TonnesPerYear / 1000), `${r.seg.lengthKm} km`, int(r.aadt)]),
        },
        highlight: { segments: top.map((r) => r.seg.id) },
      };
    },
    growth(twin, p) {
      const g = Number(p.growth) / 100;
      const base = countryYear();
      const alt = countryYear({ growth: g });
      const newly = alt.rows.filter((r, i) => r.peakVc > 1 && base.rows[i].peakVc <= 1);
      return {
        headline: `With ${pct(g)} more traffic, ${alt.overCapacity} segments exceed capacity in the peak hour (today ${base.overCapacity}).`,
        body: [
          newly.length ? `Newly over capacity: ${newly.map((r) => r.seg.name).join(", ")}.` : "No segment crosses its capacity for the first time.",
          `Congested hours rise from ${int(base.congestedHoursPerYear)} to ${int(alt.congestedHoursPerYear)} segment-hours a year; CO2 rises by ${int((alt.co2TonnesPerYear - base.co2TonnesPerYear) / 1000)} kt.`,
        ],
        table: {
          head: ["Segment", "Peak load today", `With +${pct(g)}`],
          rows: [...alt.rows]
            .sort((a, b) => b.peakVc - a.peakVc)
            .slice(0, 6)
            .map((r) => [r.seg.name, pct(base.rows.find((b) => b.id === r.id).peakVc), pct(r.peakVc)]),
        },
        highlight: { segments: alt.rows.filter((r) => r.peakVc > 0.95).map((r) => r.id) },
      };
    },
    rail(twin, p) {
      const share = Number(p.share) / 100;
      const on = p.road === "all" ? null : p.road;
      const base = countryYear();
      const alt = countryYear({ railShift: share, railShiftOn: on });
      const affected = alt.rows.filter((r) => !on || r.seg.road === on);
      const trucks = affected.reduce((n, r) => n + (base.rows.find((b) => b.id === r.id).hgvPerDay - r.hgvPerDay), 0);
      const dCo2 = base.co2TonnesPerYear - alt.co2TonnesPerYear;
      return {
        headline: `Moving ${pct(share)} of trucks ${on ? `on the ${on}` : "on all motorways"} to rail saves about ${int(dCo2 / 1000)} kt of road CO2 a year.`,
        body: [
          `That is about ${int(trucks)} fewer truck trips per segment-day. Rail freight emits too (roughly a fifth of a truck per tonne-km), so the net saving is somewhat smaller.`,
          `Peak load drops most where trucks are a large share: ${affected.sort((a, b) => b.seg.hgv - a.seg.hgv)[0].seg.name}.`,
        ],
        facts: [
          ["Road CO2 saved", `${int(dCo2 / 1000)} kt/year`],
          ["Segments affected", String(affected.length)],
        ],
        highlight: { segments: affected.map((r) => r.id) },
      };
    },
    limit(twin, p) {
      const limit = Number(p.limit);
      const base = countryYear();
      const alt = countryYear({ speedLimit: limit });
      const d = base.co2TonnesPerYear - alt.co2TonnesPerYear;
      const extraMin = (100 / (limit * 0.95) - 100 / 128) * 60;
      return {
        headline: `A ${limit} km/h limit cuts motorway CO2 by about ${int(d / 1000)} kt a year (${pct(d / base.co2TonnesPerYear)}).`,
        body: [
          `On today's unlimited stretches a car would need about ${extraMin.toFixed(1)} minutes more per 100 km in free flow. In the peak hours nothing changes: traffic is slower than the limit anyway.`,
          "Fewer speed differences also make traffic flow more evenly; this statistical level does not model that.",
        ],
        facts: [
          ["CO2 today", `${(base.co2TonnesPerYear / 1e6).toFixed(2)} Mt/year`],
          [`CO2 with ${limit} km/h`, `${(alt.co2TonnesPerYear / 1e6).toFixed(2)} Mt/year`],
        ],
        highlight: { segments: segments.filter((s) => !s.limit || s.limit > limit).map((s) => s.id) },
      };
    },
    aachen(twin) {
      const day = twin.city.day(twin.scenario);
      const rows = segmentsAt("aachen").map((s) => {
        const gw = Object.entries(twin.city.gatewayDaily).find(([, g]) => g.segment === s.id);
        const link = gw ? gatewayLinks[gw[0]] : null;
        const cityDaily = link ? day.linkDaily[2 * link.index] + day.linkDaily[2 * link.index + 1] : null;
        return [s.name, int(s.aadt), cityDaily ? int(cityDaily) : "—", gw ? NODE_BY_ID[gw[0]].name : "—"];
      });
      return {
        headline: "Aachen sits where the A4 (to Köln and the Netherlands) meets the A44 (to Düsseldorf and Belgium).",
        body: [
          "The country level hands its daily volumes to the city model: each motorway gateway starts with half the segment's AADT per direction, split into traffic for Aachen and traffic passing through.",
          "Comparing the two columns checks that the levels agree.",
        ],
        table: { head: ["Country segment", "AADT (country)", "City model, vehicles/day", "City gateway"], rows },
        highlight: { segments: segmentsAt("aachen").map((s) => s.id) },
      };
    },
  },

  city: {
    bottlenecks(twin, p) {
      const h = Number(p.hour);
      const r = twin.city.hour(h, twin.scenario);
      const rows = [];
      for (let e = 0; e < r.flow.length; e++) if (Number.isFinite(r.minutes[e])) rows.push({ e, vc: r.vc[e], kmh: r.speed[e], q: r.flow[e] });
      rows.sort((a, b) => b.vc - a.vc);
      const top = rows.slice(0, 6);
      const over = rows.filter((x) => x.vc > 1).length;
      return {
        headline: `At ${hourLabel(h)} the tightest spot is ${edgeLabel(top[0].e)}: demand is ${pct(top[0].vc)} of capacity and traffic crawls at about ${int(top[0].kmh)} km/h.`,
        body: [
          over ? `${over} street direction${over === 1 ? " is" : "s are"} over capacity in this hour.` : "No street is over capacity in this hour.",
          `The tightest streets are ${[...new Set(top.map((x) => links[x.e >> 1].label.toLowerCase()))].join(" and ")} links; the motorways around Aachen ${
            rows.filter((x) => links[x.e >> 1].cls === "motorway").every((x) => x.vc < 0.9) ? "have spare capacity" : "are busy too"
          }.`,
        ],
        table: { head: ["Street, direction", "Vehicles/h", "Load", "Speed"], rows: top.map((x) => [edgeLabel(x.e), int(x.q), pct(x.vc), `${int(x.kmh)} km/h`]) },
        highlight: { links: [...new Set(top.map((x) => links[x.e >> 1].id))] },
      };
    },
    closure(twin, p) {
      const variant = { ...twin.scenario, closed: [...new Set([...twin.scenario.closed, p.link])] };
      const out = compareCity(twin, variant, `Closing ${linkName(p.link)}`);
      out.highlight.links.push(p.link);
      out.closed = [p.link];
      return out;
    },
    buslane(twin, p) {
      const variant = { ...twin.scenario, busLanes: [...new Set([...twin.scenario.busLanes, p.link])] };
      const out = compareCity(twin, variant, `A bus lane on ${linkName(p.link)} (one car lane less)`);
      out.body.push("The bus side of the trade-off (faster, more reliable buses) is not in this traffic model yet.");
      out.highlight.links.push(p.link);
      return out;
    },
    zone30(twin) {
      const out = compareCity(twin, { ...twin.scenario, zone30: true }, "30 km/h inside the Alleenring");
      out.body.unshift("Through traffic moves out to the outer arterials and motorways; trips into the centre take a little longer.");
      if (out.table.rows.some((r) => /^(Pont|Peter|Franz|Jakob)straße/.test(r[0]))) {
        out.body.push("Watch out: some drivers cut through the old-town streets instead. Pair the zone with access-only rules there.");
      }
      out.highlight.links = [...ZONE30];
      return out;
    },
    demand(twin, p) {
      const f = 1 - Number(p.pct) / 100;
      return compareCity(twin, { ...twin.scenario, demand: twin.scenario.demand * f }, `${p.pct}% fewer car trips`);
    },
    outside() {
      const s = demandSummary();
      const total = s.local + s.inbound + s.through;
      return {
        headline: `${pct((s.inbound + s.through) / total)} of the vehicle trips on Aachen's roads start or end outside the city.`,
        body: [
          `About ${int(s.inbound)} trips a day come in or go out: commuters and visitors from the region and across the Dutch and Belgian borders. ${int(s.through)} more pass through on the motorways without stopping.`,
          "The motorway gateways take their volumes from the Germany level; local roads to Vaals, Kelmis, the Eifel and Würselen use regional counts.",
        ],
        facts: [
          ["Inside Aachen", `${int(s.local)} trips/day`],
          ["To or from outside", `${int(s.inbound)} trips/day`],
          ["Through traffic", `${int(s.through)} trips/day`],
        ],
        highlight: { links: Object.values(gatewayLinks).map((l) => l.id) },
      };
    },
    daily(twin) {
      const d = twin.city.day(twin.scenario);
      const t = d.totals;
      return {
        headline: `On a weekday, vehicles drive about ${(t.vkt / 1e6).toFixed(2)} million km in the model area and emit about ${int(t.co2Kg / 1000)} tonnes of CO2.`,
        body: [
          `They spend ${int(t.vht)} hours on the road, ${int(t.delayH)} of them (${pct(t.delayH / t.vht)}) are delay compared with empty roads.`,
          "Motorway kilometres around the city are included; through traffic accounts for a large share of them.",
        ],
        facts: [
          ["Vehicle trips", `${int(t.trips)}/day`],
          ["Vehicle-km", `${int(t.vkt)}/day`],
          ["Vehicle-hours", `${int(t.vht)}/day`],
          ["CO2", `${int(t.co2Kg / 1000)} t/day`],
        ],
        series: { label: "Vehicle-km per hour", unit: "veh-km", values: d.hours.map((h) => h.totals.vkt), mark: twin.hour },
      };
    },
    peak(twin) {
      const d = twin.city.day(twin.scenario);
      const delay = d.hours.map((h) => h.totals.delayH);
      const am = delay.slice(0, 12).indexOf(Math.max(...delay.slice(0, 12)));
      const pm = 12 + delay.slice(12).indexOf(Math.max(...delay.slice(12)));
      const worst = delay[am] >= delay[pm] ? am : pm;
      return {
        headline: `The worst hour is ${hourLabel(worst)}: ${int(delay[worst])} vehicle-hours of delay, against ${int(Math.min(...delay))} at night.`,
        body: [`Morning peak ${hourLabel(am)}, afternoon peak ${hourLabel(pm)}. The afternoon peak lasts longer, the morning one is sharper because more trips start at the same time.`],
        series: { label: "Delay (vehicle-hours) per hour", unit: "veh-h", values: delay, mark: worst },
      };
    },
    calibration(twin) {
      const rows = twin.calibration().filter((r) => r.minutes >= 3);
      if (!rows.length) {
        return { headline: "The street sensors have not collected enough data yet. Let the clock run for a few minutes.", body: [] };
      }
      const worst = [...rows].sort((a, b) => Math.abs(1 - (b.ratio ?? 1)) - Math.abs(1 - (a.ratio ?? 1)))[0];
      const under = rows.filter((r) => r.ratio !== null && r.ratio < 0.8);
      return {
        headline: `Sensors and model agree within ${pct(Math.abs(1 - worst.ratio))} on the worst link (${worst.name}, towards ${worst.to}).`,
        body: [
          under.length
            ? `Where the sensors count much less than the model (${under.map((r) => `${r.name} → ${r.to}`).join("; ")}), the street cannot serve the demand: queues back up beyond the corridor. The hourly model underestimates that.`
            : "Where the counts differ, it is mostly random variation within the 15-minute window.",
          "This is the bottom-up half of the hierarchy: what the street level measures tells the city level how far to trust its numbers.",
        ],
        table: {
          head: ["Corridor link, direction", "Model veh/h", "Sensors veh/h", "Ratio"],
          rows: rows.map((r) => [`${r.name}: ${r.from} → ${r.to}`, int(r.model), int(r.sensed), r.ratio === null ? "—" : r.ratio.toFixed(2)]),
        },
        highlight: { links: [...new Set(rows.map((r) => r.link))] },
      };
    },
  },

  corridor: {
    traveltime(twin, p, ctx) {
      const sim = twin.corridors[ctx.corridor];
      const i = Number(p.from);
      const j = Number(p.to);
      if (i === j) return { headline: "Pick two different places.", body: [] };
      const tt = sim.travelTime(i, j);
      const model = cityMinutesAlong(twin, sim, i, j, twin.dayTime) * 60;
      const st = sim.def.stations;
      return {
        headline: `From ${st[i].name} to ${st[j].name} takes about ${mins(tt.seconds)} right now (${(tt.metres / 1000).toFixed(1)} km, ${int((tt.metres / tt.seconds) * 3.6)} km/h on average).`,
        body: [
          tt.method === "measured"
            ? `Measured from ${tt.samples} vehicles that drove this stretch in the last 15 minutes.`
            : "Too few vehicles have driven this stretch recently, so this is an estimate: free flow plus average waiting at the lights.",
          `The city-level model expects ${mins(model)} for this hour. ${Math.abs(model - tt.seconds) > 0.25 * model ? "The street level sees a real difference: trust the measurement." : "Both levels agree."}`,
        ],
        facts: [
          ["Street level (now)", mins(tt.seconds)],
          ["City model (this hour)", mins(model)],
        ],
        highlight: { stations: [i, j] },
      };
    },
    green(twin, p, ctx) {
      const sim = twin.corridors[ctx.corridor];
      const i = Number(p.junction);
      const dist = Number(p.dist);
      const sig = sim.signal(i);
      const name = sim.def.stations[i].name;
      const glosa = sim.greenSpeed(i, dist);
      const now = sig.state === "green" ? `It is green for another ${Math.round(sig.toChange)} s.` : `It is ${sig.state} now and turns green in ${Math.round(sig.state === "amber" ? sig.toChange + (sig.cycle - sig.green - 3) : sig.toChange)} s.`;
      return {
        headline: glosa.kmh ? `Drive about ${glosa.kmh} km/h and you reach ${name} on green.` : `You will most likely have to stop at ${name}; coast and save fuel.`,
        body: [
          now,
          `Cycle ${sig.cycle} s, ${sig.green} s green for this street. The lights along the corridor are timed as a green wave at 45 km/h in the outbound direction.`,
          "Connected vehicles receive this as signal phase and timing (SPaT) messages from the roadside unit.",
        ],
        facts: [
          ["Signal now", sig.state],
          ["Distance", `${dist} m`],
          ["Advice", glosa.kmh ? `${glosa.kmh} km/h` : "prepare to stop"],
        ],
        highlight: { stations: [i] },
      };
    },
    queue(twin, p, ctx) {
      const sim = twin.corridors[ctx.corridor];
      const i = Number(p.junction);
      const m = sim.mast(i);
      const sig = sim.signal(i);
      const st = sim.def.stations;
      const dirName = (d) => `towards ${d === 0 ? st.at(-1).name : st[0].name}`;
      const perCycle = 2 * (sig.green / 2.1); // two lanes, ~2.1 s per vehicle while green
      const worst = m.queue[0].vehicles >= m.queue[1].vehicles ? 0 : 1;
      const q = m.queue[worst];
      return {
        headline: q.vehicles
          ? `${q.vehicles} vehicles are waiting at ${m.name} ${dirName(worst)}, a queue of about ${int(q.metres)} m.`
          : `No queue at ${m.name} right now.`,
        body: [
          q.vehicles ? `At ${int(perCycle)} vehicles per green phase it should clear in ${Math.max(1, Math.ceil(q.vehicles / perCycle))} cycle${Math.ceil(q.vehicles / perCycle) > 1 ? "s" : ""} (${Math.ceil(q.vehicles / perCycle) * sig.cycle} s at most).` : null,
          m.health === "ok" ? `The sensor mast sees ${m.detections.length} vehicles within ${m.range} m.` : `The sensor mast here is degraded and misses many vehicles: the real queue may be longer.`,
        ].filter(Boolean),
        facts: [0, 1].map((d) => [dirName(d), `${m.queue[d].vehicles} veh, ${int(m.queue[d].metres)} m`]),
        highlight: { stations: [i] },
      };
    },
    ahead(twin, p, ctx) {
      const sim = twin.corridors[ctx.corridor];
      const st = sim.def.stations;
      const nearest = (x) => st.reduce((a, s) => (Math.abs(s.x - x) < Math.abs(a.x - x) ? s : a), st[0]);
      const items = sim.incidents.map(
        (inc) => `${inc.kind} in the ${inc.lane === 1 ? "left" : "right"} lane towards ${inc.d === 0 ? st.at(-1).name : st[0].name}, near ${nearest(inc.x).name}, since ${hhmm(inc.since % DAY)}.`,
      );
      const degraded = sim.health.map((h, i) => (h !== "ok" ? st[i].name : null)).filter(Boolean);
      const dirs = [0, 1].map((d) => sim.directionStats(d));
      const backlog = dirs.map((s, d) => (s.waitingToEnter > 5 ? `${s.waitingToEnter} vehicles are queued beyond ${d === 0 ? st[0].name : st.at(-1).name} trying to enter.` : null)).filter(Boolean);
      return {
        headline: items.length ? `Yes: ${items.length === 1 ? "one lane is blocked" : `${items.length} lanes are blocked`}.` : "The road is clear: no incidents reported.",
        body: [...items, ...backlog, degraded.length ? `Sensor coverage is degraded at ${degraded.join(", ")}: incidents there could be missed.` : "All sensor masts are healthy."],
        facts: [0, 1].map((d) => [`Towards ${d === 0 ? st.at(-1).name : st[0].name}`, `${dirs[d].vehicles} veh, ${dirs[d].meanKmh === null ? "—" : int(dirs[d].meanKmh)} km/h, ${dirs[d].stopped} stopped`]),
      };
    },
    leave(twin, p, ctx) {
      const sim = twin.corridors[ctx.corridor];
      const i = Number(p.from);
      const j = Number(p.to);
      if (i === j) return { headline: "Pick two different places.", body: [] };
      const nowS = sim.travelTime(i, j).seconds;
      const options = [0, 15, 30, 45, 60, 90].map((m) => {
        const t = twin.dayTime + m * 60;
        const model = cityMinutesAlong(twin, sim, i, j, t) * 60;
        // Scale the forecast by how the street compares with the model right now.
        const ratio = nowS / Math.max(1, cityMinutesAlong(twin, sim, i, j, twin.dayTime) * 60);
        return { m, seconds: m === 0 ? nowS : model * Math.min(2, Math.max(0.5, ratio)), at: hhmm(t) };
      });
      const best = options.reduce((a, b) => (b.seconds + b.m * 60 * 0.15 < a.seconds + a.m * 60 * 0.15 ? b : a));
      const st = sim.def.stations;
      return {
        headline:
          best.m === 0
            ? `Leave now: ${st[i].name} to ${st[j].name} takes about ${mins(nowS)}, and it will not get much better.`
            : `Waiting ${best.m} minutes saves time: leaving at ${best.at} takes about ${mins(best.seconds)} instead of ${mins(nowS)}.`,
        body: [
          "The answer for now comes from the street level (vehicles measured by the sensors); the forecast comes from the city level, which knows how traffic changes over the day.",
        ],
        table: { head: ["Leave at", "Drive time"], rows: options.map((o) => [o.m === 0 ? `now (${o.at})` : o.at, mins(o.seconds)]) },
        highlight: { stations: [i, j] },
      };
    },
  },
};

/** Answer a question; ctx carries the corridor for the driver's questions. */
export function answer(twin, level, qid, params = {}, ctx = {}) {
  const q = QUESTIONS[level].find((x) => x.id === qid);
  if (!q) throw new Error(`unknown question ${level}/${qid}`);
  const context = { corridor: params.corridor ?? ctx.corridor };
  const full = { ...(q.defaults ? q.defaults(twin, context) : {}), ...params };
  const out = ANSWERS[level][qid](twin, full, context);
  return {
    level,
    qid,
    params: full,
    question: questionText(twin, level, qid, full, context),
    body: [],
    facts: [],
    highlight: {},
    ...out,
    basis: BASIS[level],
    time: twin.clock,
  };
}

// -- free text -----------------------------------------------------------------------------------
const norm = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss");

/**
 * Pick the catalogue question that best matches typed text, and fill what parameters it can
 * (numbers, hours, street, motorway and junction names). Returns null when nothing fits.
 */
export function matchQuestion(twin, level, text, ctx = {}) {
  const t = norm(text);
  let best = null;
  for (const q of QUESTIONS[level]) {
    let score = 0;
    for (const k of q.keywords) if (t.includes(norm(k))) score += k.length > 3 ? 2 : 1;
    if (score > 0 && (!best || score > best.score)) best = { q, score };
  }
  if (!best) return null;
  const q = best.q;
  const params = { ...(q.defaults ? q.defaults(twin, ctx) : {}) };
  const numbers = [...t.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => Number(m[1].replace(",", ".")));
  for (const p of q.params ?? []) {
    const opts = p.options(twin, ctx);
    if (p.key === "hour") {
      const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|uhr|h)?/);
      if (m) {
        let h = Number(m[1]);
        if (m[3] === "pm" && h < 12) h += 12;
        if (h < 24) params.hour = h;
      }
      continue;
    }
    if (["growth", "share", "pct", "limit", "dist"].includes(p.key)) {
      const n = numbers.find((x) => opts.some((o) => o.value === x)) ?? numbers.find((x) => x > 0 && x <= (p.key === "limit" ? 200 : p.key === "dist" ? 2000 : 100));
      if (n !== undefined) {
        // Snap to the nearest offered value so the form can show it.
        params[p.key] = opts.reduce((a, o) => (Math.abs(o.value - n) < Math.abs(a.value - n) ? o : a), opts[0]).value;
      }
      continue;
    }
    // Names: longest option label (or its first part) that appears in the text.
    const hits = opts
      .map((o) => {
        const label = norm(String(o.label));
        const head = label.split(" (")[0].replace(/^junction /, "");
        const found = t.includes(label) ? label.length : head.length > 2 && t.includes(head) ? head.length : 0;
        return { o, found, pos: found ? t.indexOf(head) : -1 };
      })
      .filter((h) => h.found);
    if (!hits.length) continue;
    if (p.key === "from" || p.key === "to") {
      // Two places: the first mentioned is the start. One place: "to X" makes it the goal.
      hits.sort((a, b) => a.pos - b.pos);
      const [first, second] = hits;
      const isGoal = !second && /\bto\s*$/.test(t.slice(0, first.pos).trimEnd() + " ");
      const pick = second ? (p.key === "from" ? first : second) : (p.key === "to") === isGoal ? first : null;
      if (pick) params[p.key] = pick.o.value;
      continue;
    }
    hits.sort((a, b) => b.found - a.found);
    params[p.key] = hits[0].o.value;
  }
  return { qid: q.id, params };
}

export { SEG_BY_ID };
