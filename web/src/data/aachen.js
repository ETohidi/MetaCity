// Level 2 and 3 data: a schematic road network of Aachen.
// Street and district names are real so the map reads naturally; node positions are
// approximate, the network is simplified, and every flow, count and sensor on it is
// simulated. Population and job figures are rounded illustrative values.

export const CENTER = { lon: 6.0838, lat: 50.776 };

// kind: "inner" (inside the ring), "ring", "outer" (district), "motorway", "gateway" (edge of the model)
export const NODES = [
  { id: "markt", name: "Markt", lon: 6.0838, lat: 50.776, kind: "inner" },
  { id: "ponttor", name: "Ponttor", lon: 6.079, lat: 50.7815, kind: "ring" },
  { id: "hansemann", name: "Hansemannplatz", lon: 6.0915, lat: 50.78, kind: "ring" },
  { id: "kaiserplatz", name: "Kaiserplatz", lon: 6.0965, lat: 50.7735, kind: "ring" },
  { id: "hbf", name: "Hauptbahnhof", lon: 6.0905, lat: 50.7685, kind: "ring" },
  { id: "marschiertor", name: "Marschiertor", lon: 6.081, lat: 50.77, kind: "ring" },
  { id: "koenigstor", name: "Königstor", lon: 6.0705, lat: 50.7745, kind: "ring" },
  { id: "europaplatz", name: "Europaplatz", lon: 6.1, lat: 50.7845, kind: "outer" },
  { id: "laurensberg", name: "Laurensberg", lon: 6.06, lat: 50.796, kind: "outer" },
  { id: "melaten", name: "Campus Melaten", lon: 6.05, lat: 50.78, kind: "outer" },
  { id: "soers", name: "Soers", lon: 6.09, lat: 50.8, kind: "outer" },
  { id: "haaren", name: "Haaren", lon: 6.125, lat: 50.796, kind: "outer" },
  { id: "eilendorf", name: "Eilendorf", lon: 6.155, lat: 50.78, kind: "outer" },
  { id: "forst", name: "Forst", lon: 6.12, lat: 50.76, kind: "outer" },
  { id: "brand", name: "Brand", lon: 6.165, lat: 50.75, kind: "outer" },
  { id: "burtscheid", name: "Burtscheid", lon: 6.095, lat: 50.76, kind: "outer" },
  { id: "ronheide", name: "Ronheide", lon: 6.065, lat: 50.755, kind: "outer" },
  { id: "a4_laurensberg", name: "A4 Laurensberg", lon: 6.065, lat: 50.81, kind: "motorway" },
  { id: "a4_soers", name: "A4 Soers", lon: 6.1, lat: 50.815, kind: "motorway" },
  { id: "kreuz", name: "Aachener Kreuz", lon: 6.165, lat: 50.825, kind: "motorway" },
  { id: "a44_brand", name: "A44 Brand", lon: 6.17, lat: 50.765, kind: "motorway" },
  { id: "a44_lichtenbusch", name: "A44 Lichtenbusch", lon: 6.12, lat: 50.725, kind: "motorway" },
  { id: "gw_nl", name: "A4 → Heerlen (NL)", lon: 6.015, lat: 50.815, kind: "gateway" },
  { id: "gw_koeln", name: "A4 → Köln", lon: 6.26, lat: 50.845, kind: "gateway" },
  { id: "gw_ddorf", name: "A44 → Düsseldorf", lon: 6.21, lat: 50.89, kind: "gateway" },
  { id: "gw_be", name: "A44 → Liège (BE)", lon: 6.1, lat: 50.7, kind: "gateway" },
  { id: "gw_vaals", name: "Vaals (NL)", lon: 6.015, lat: 50.775, kind: "gateway" },
  { id: "gw_kelmis", name: "Kelmis (BE)", lon: 6.04, lat: 50.73, kind: "gateway" },
  { id: "gw_eifel", name: "Kornelimünster / Eifel", lon: 6.18, lat: 50.715, kind: "gateway" },
  { id: "gw_wuerselen", name: "Würselen", lon: 6.13, lat: 50.83, kind: "gateway" },
];

// Road classes: capacity per direction (vehicles/h), free-flow speed (km/h), BPR alpha, HGV share.
export const ROAD_CLASS = {
  motorway: { cap: 3800, kmh: 110, alpha: 0.15, hgv: 0.15, label: "Motorway" },
  arterial: { cap: 1600, kmh: 50, alpha: 0.6, hgv: 0.05, label: "Arterial" },
  ring: { cap: 1900, kmh: 50, alpha: 0.6, hgv: 0.04, label: "Ring road" },
  rural: { cap: 1200, kmh: 70, alpha: 0.4, hgv: 0.07, label: "Rural road" },
  inner: { cap: 500, kmh: 15, alpha: 0.8, hgv: 0.02, label: "Old town street" },
};

// [id, from, to, class, street name]
const ROWS = [
  ["ring1", "ponttor", "hansemann", "ring", "Alleenring (Monheimsallee)"],
  ["ring2", "hansemann", "kaiserplatz", "ring", "Alleenring (Heinrichsallee)"],
  ["ring3", "kaiserplatz", "hbf", "ring", "Alleenring (Wilhelmstraße)"],
  ["ring4", "hbf", "marschiertor", "ring", "Alleenring (Römerstraße)"],
  ["ring5", "marschiertor", "koenigstor", "ring", "Alleenring (Boxgraben)"],
  ["ring6", "koenigstor", "ponttor", "ring", "Alleenring (Turmstraße)"],
  ["in1", "markt", "ponttor", "inner", "Pontstraße"],
  ["in2", "markt", "hansemann", "inner", "Peterstraße"],
  ["in3", "markt", "marschiertor", "inner", "Franzstraße"],
  ["in4", "markt", "koenigstor", "inner", "Jakobstraße"],
  ["jul1", "hansemann", "europaplatz", "arterial", "Jülicher Straße"],
  ["jul2", "europaplatz", "haaren", "arterial", "Jülicher Straße"],
  ["wue", "haaren", "gw_wuerselen", "rural", "Haarener Gracht → Würselen"],
  ["kre1", "ponttor", "soers", "arterial", "Krefelder Straße"],
  ["kre2", "soers", "a4_soers", "arterial", "Krefelder Straße"],
  ["roe1", "ponttor", "laurensberg", "arterial", "Roermonder Straße"],
  ["roe2", "laurensberg", "a4_laurensberg", "arterial", "Roermonder Straße"],
  ["vaa1", "koenigstor", "melaten", "arterial", "Vaalser Straße"],
  ["vaa2", "melaten", "gw_vaals", "rural", "Vaalser Straße"],
  ["pau", "melaten", "laurensberg", "arterial", "Pauwelsstraße"],
  ["lue1", "koenigstor", "ronheide", "arterial", "Lütticher Straße"],
  ["lue2", "ronheide", "gw_kelmis", "rural", "Lütticher Straße"],
  ["bur1", "hbf", "burtscheid", "arterial", "Zollernstraße"],
  ["bur2", "burtscheid", "a44_lichtenbusch", "rural", "Monschauer Straße"],
  ["bur3", "burtscheid", "forst", "arterial", "Burtscheid – Forst"],
  ["tri1", "kaiserplatz", "forst", "arterial", "Trierer Straße"],
  ["tri2", "forst", "brand", "arterial", "Trierer Straße"],
  ["tri3", "brand", "a44_brand", "arterial", "Trierer Straße"],
  ["tri4", "brand", "gw_eifel", "rural", "Trierer Straße → Eifel"],
  ["eil1", "europaplatz", "eilendorf", "arterial", "Europaplatz – Eilendorf"],
  ["eil2", "eilendorf", "a44_brand", "rural", "Eilendorf – A44"],
  ["a4w", "gw_nl", "a4_laurensberg", "motorway", "A4"],
  ["a4a", "a4_laurensberg", "a4_soers", "motorway", "A4"],
  ["a4b", "a4_soers", "kreuz", "motorway", "A4"],
  ["a4e", "kreuz", "gw_koeln", "motorway", "A4"],
  ["a44n", "kreuz", "gw_ddorf", "motorway", "A44"],
  ["a44a", "kreuz", "a44_brand", "motorway", "A44"],
  ["a44b", "a44_brand", "a44_lichtenbusch", "motorway", "A44"],
  ["a44s", "a44_lichtenbusch", "gw_be", "motorway", "A44"],
  ["a544", "kreuz", "europaplatz", "motorway", "A544"],
];

export const LINKS = ROWS.map(([id, from, to, cls, name]) => ({ id, from, to, cls, name }));

// Traffic analysis zones: each loads onto one network node (or several, see Mitte).
export const ZONES = [
  // The old town is mostly pedestrian: its car trips start and end at the garages on the ring.
  { id: "mitte", name: "Mitte (old town)", node: "markt", nodes: ["ponttor", "hansemann", "marschiertor", "koenigstor"], pop: 38000, jobs: 52000 },
  { id: "frankenberg", name: "Frankenberger Viertel", node: "kaiserplatz", pop: 26000, jobs: 9000 },
  { id: "burtscheid", name: "Burtscheid", node: "burtscheid", pop: 24000, jobs: 8000 },
  { id: "laurensberg", name: "Laurensberg", node: "laurensberg", pop: 22000, jobs: 6000 },
  { id: "melaten", name: "Campus Melaten", node: "melaten", pop: 7000, jobs: 26000 },
  { id: "soers", name: "Soers", node: "soers", pop: 6000, jobs: 4000 },
  { id: "rotheerde", name: "Rothe Erde", node: "europaplatz", pop: 9000, jobs: 11000 },
  { id: "haaren", name: "Haaren", node: "haaren", pop: 12000, jobs: 5000 },
  { id: "eilendorf", name: "Eilendorf", node: "eilendorf", pop: 16000, jobs: 6000 },
  { id: "forst", name: "Forst", node: "forst", pop: 15000, jobs: 7000 },
  { id: "brand", name: "Brand", node: "brand", pop: 18000, jobs: 5000 },
  { id: "west", name: "Hörn / Ronheide", node: "ronheide", pop: 14000, jobs: 4000 },
];

// Where the city model meets the country model. Motorway gateways take their daily volume from
// the Germany level (half the AADT of the named segment, i.e. one direction); `toCity` is the
// share that starts or ends inside Aachen, and `through` splits the rest across other gateways.
// Local gateways have a fixed illustrative daily volume per direction.
export const GATEWAYS = [
  { node: "gw_koeln", segment: "A4-aachen-koeln", toCity: 0.42, through: { gw_nl: 0.45, gw_be: 0.55 } },
  { node: "gw_nl", segment: "A4-nl-aachen", toCity: 0.35, through: { gw_koeln: 0.7, gw_ddorf: 0.3 } },
  { node: "gw_ddorf", segment: "A44-aachen-duesseldorf", toCity: 0.45, through: { gw_be: 0.6, gw_nl: 0.4 } },
  { node: "gw_be", segment: "A44-be-aachen", toCity: 0.3, through: { gw_koeln: 0.6, gw_ddorf: 0.4 } },
  { node: "gw_vaals", daily: 9000, toCity: 1 },
  { node: "gw_kelmis", daily: 6000, toCity: 1 },
  { node: "gw_eifel", daily: 7000, toCity: 1 },
  { node: "gw_wuerselen", daily: 12000, toCity: 1 },
];

// Level 3: corridors simulated vehicle by vehicle. `nodes` follow the city network; extra
// signalised junctions sit between them at the given fraction of a link.
export const CORRIDORS = [
  {
    id: "julicher",
    name: "Jülicher Straße",
    blurb: "Arterial from the ring to Haaren, crossing Europaplatz where the A544 ends.",
    nodes: ["hansemann", "europaplatz", "haaren"],
    extraJunctions: [
      { link: 0, at: 0.5, name: "Junction Blücherplatz" },
      { link: 1, at: 0.35, name: "Junction Prager Ring" },
      { link: 1, at: 0.7, name: "Junction Haarener Gracht" },
    ],
  },
  {
    id: "campus",
    name: "Campus corridor",
    blurb: "Vaalser Straße and Pauwelsstraße from the ring past Campus Melaten to Laurensberg.",
    nodes: ["koenigstor", "melaten", "laurensberg"],
    extraJunctions: [
      { link: 0, at: 0.45, name: "Junction Westpark" },
      { link: 1, at: 0.5, name: "Junction Campus Boulevard" },
    ],
  },
];

export const NODE_BY_ID = Object.fromEntries(NODES.map((n) => [n.id, n]));
export const LINK_BY_ID = Object.fromEntries(LINKS.map((l) => [l.id, l]));
export const CORRIDOR_BY_ID = Object.fromEntries(CORRIDORS.map((c) => [c.id, c]));
