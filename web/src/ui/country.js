// Level 1: Germany. Motorway segments drawn from statistics, coloured by the load a typical
// weekday has at the current hour. d3 is a global from index.html.

import germanyGeo from "../data/germany.js";
import { cities, countryYear, segmentHour, segments, SEG_BY_ID, segmentYear } from "../engine/country.js";
import { askHighlight, askPanel, bindAsk } from "./ask.js";
import { chip, fidelityCard, hourBars, html, int, kmh, LOAD_LABEL, loadColor, loadTone, meter, pct, raw } from "./dom.js";

const W = 640;
const H = 760;
let geo = null;

function geometry() {
  if (geo) return geo;
  const projection = d3.geoMercator().fitExtent(
    [
      [96, 16],
      [W - 16, H - 16],
    ],
    germanyGeo,
  );
  const path = d3.geoPath(projection);
  const pt = (c) => projection([c.lon, c.lat]);
  const byId = Object.fromEntries(cities.map((c) => [c.id, c]));
  geo = {
    states: germanyGeo.features.map((f) => ({ name: f.properties.name, d: path(f) })),
    cities: cities.map((c) => ({ ...c, xy: pt(c) })),
    segs: segments.map((s) => ({ s, a: pt(byId[s.from]), b: pt(byId[s.to]) })),
  };
  return geo;
}

const width = (aadt) => (1.5 + aadt / 22000).toFixed(2);

function mapSvg() {
  const g = geometry();
  const aachen = g.cities.find((c) => c.twin);
  return html`<svg class="map map-country" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of Germany with motorway segments coloured by current load">
    <g class="states">${g.states.map((s) => html`<path d="${s.d}"><title>${s.name}</title></path>`)}</g>
    <g class="segs">
      ${g.segs.map(
        ({ s, a, b }) => html`<g class="seg" data-seg="${s.id}" tabindex="0" role="button" aria-label="${s.name}">
          <line class="seg-hit" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" />
          <line class="seg-halo" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke-width="${(Number(width(s.aadt)) + 5).toFixed(1)}" />
          <line class="seg-line" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke-width="${width(s.aadt)}" />
          <title>${s.name}</title>
        </g>`,
      )}
    </g>
    <g class="cities">
      ${g.cities
        .filter((c) => !c.twin)
        .map(
          (c) => html`<g class="city${c.border ? " is-border" : ""}" transform="translate(${c.xy[0].toFixed(1)},${c.xy[1].toFixed(1)})">
            <circle r="${c.border ? 2.5 : 3.5}" />
            <text x="6" y="4">${c.name}</text>
          </g>`,
        )}
    </g>
    <g class="twin-city" transform="translate(${aachen.xy[0].toFixed(1)},${aachen.xy[1].toFixed(1)})" data-go="aachen" tabindex="0" role="link" aria-label="Open the Aachen city twin">
      <circle class="pulse" r="10" />
      <circle class="dot" r="6.5" />
      <text x="-12" y="-14" text-anchor="end">Aachen</text>
      <text class="cta" x="-12" y="24" text-anchor="end">open city twin →</text>
    </g>
  </svg>`;
}

function updateMap(root, ctx) {
  const hl = new Set(askHighlight(ctx.ui, "country").segments ?? []);
  const sel = ctx.ui.sel.segment;
  const h = ctx.twin.hour;
  for (const el of root.querySelectorAll(".seg")) {
    const s = SEG_BY_ID[el.dataset.seg];
    const load = segmentHour(s, h);
    el.querySelector(".seg-line").style.stroke = loadColor(load.vc);
    el.classList.toggle("is-hl", hl.has(s.id));
    el.classList.toggle("is-sel", sel === s.id);
  }
}

function live(ctx) {
  const { twin, ui } = ctx;
  const h = twin.hour;
  const year = countryYear();
  const now = segments.map((s) => ({ s, ...segmentHour(s, h) })).sort((a, b) => b.vc - a.vc);
  const top = now[0];
  const seg = ui.sel.segment ? SEG_BY_ID[ui.sel.segment] : null;
  const segNow = seg ? segmentHour(seg, h) : null;
  const segYear = seg ? segmentYear(seg) : null;
  return html`
    <section class="card">
      <div class="eyebrow">Typical weekday, ${twin.clock}</div>
      <div class="grid-3 stats">
        <div class="stat"><span class="stat-value">${(year.co2TonnesPerYear / 1e6).toFixed(1)} Mt</span><span class="stat-label">CO2 a year on these motorways</span></div>
        <div class="stat"><span class="stat-value">${year.overCapacity}</span><span class="stat-label">segments over capacity at peak</span></div>
        <div class="stat"><span class="stat-value">${now.filter((r) => r.vc > 0.95).length}</span><span class="stat-label">congested right now</span></div>
      </div>
      <p class="muted small">Most loaded now: <strong>${top.s.name}</strong>, ${pct(top.vc)} of capacity, about ${kmh(top.kmh)}.</p>
    </section>
    ${
      seg
        ? html`<section class="card" aria-label="Selected segment">
            <div class="row between"><h3>${seg.name}</h3>${chip(LOAD_LABEL[loadTone(segNow.vc)], loadTone(segNow.vc))}</div>
            ${meter(segNow.vc)}
            <dl class="kv">
              <dt>Vehicles per day (AADT)</dt><dd>${int(seg.aadt)}</dd>
              <dt>Trucks</dt><dd>${pct(seg.hgv)} · ${int(segYear.hgvPerDay)}/day</dd>
              <dt>Lanes</dt><dd>${seg.lanes} per direction</dd>
              <dt>Length</dt><dd>${seg.lengthKm} km</dd>
              <dt>Speed limit</dt><dd>${seg.limit ? `${seg.limit} km/h` : "none (advisory 130)"}</dd>
              <dt>Now, peak direction</dt><dd>${int(segNow.vehPerHour)} veh/h · ${kmh(segNow.kmh)}</dd>
              <dt>Congested hours</dt><dd>${int(segYear.congestedHoursPerYear)} a year</dd>
              <dt>CO2</dt><dd>${int(segYear.co2TonnesPerYear / 1000)} kt a year</dd>
            </dl>
            <div class="eyebrow">Load over the day</div>
            ${hourBars(
              Array.from({ length: 24 }, (_, hh) => segmentHour(seg, hh).vc),
              { mark: h, label: `Hourly load on ${seg.name}` },
            )}
            ${seg.from === "aachen" || seg.to === "aachen" ? html`<p class="small"><a href="#aachen">This segment feeds the Aachen city twin →</a></p>` : ""}
          </section>`
        : html`<p class="muted small hint">Click a motorway segment for its numbers.</p>`
    }`;
}

export function mount(view, ctx) {
  view.innerHTML = String(html`
    <div class="view-head">
      <div>
        <h1>Germany · motorway network</h1>
        <p>Level 1 of the twin. Annual statistics, spread over a typical weekday, answer questions for federal planning. Click Aachen to go one level down.</p>
      </div>
      <div class="legend" aria-label="Legend">
        <span><i class="swatch" style="background:var(--ok)"></i>below 70% of capacity</span>
        <span><i class="swatch" style="background:var(--warn)"></i>70–95%</span>
        <span><i class="swatch" style="background:var(--crit)"></i>congested</span>
        <span>line width = vehicles per day</span>
      </div>
    </div>
    <div class="layout">
      <div class="stage card card-flush map-wrap">${mapSvg()}</div>
      <aside class="panel">
        ${fidelityCard({
          level: 1,
          title: "Germany · statistics",
          data: "Annual average daily traffic (AADT) per motorway segment, truck share, lanes",
          resolution: "Segment of 40–300 km; typical-weekday hourly profile",
          update: "Yearly, when new counts are published",
          feeds: [{ dir: "down", text: "Daily volumes on the A4 and A44 become the traffic entering the Aachen model." }],
        })}
        <div data-live></div>
        <div data-ask-slot></div>
      </aside>
    </div>`);
  const map = view.querySelector(".map-country");
  const pick = (el) => {
    ctx.ui.sel.segment = ctx.ui.sel.segment === el.dataset.seg ? null : el.dataset.seg;
    update(view, ctx);
  };
  map.addEventListener("click", (e) => {
    const el = e.target.closest(".seg");
    if (el) pick(el);
  });
  map.addEventListener("keydown", (e) => {
    const el = e.target.closest(".seg");
    if (el && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      pick(el);
    }
  });
  renderAsk(view, ctx);
  update(view, ctx);
}

function renderAsk(view, ctx) {
  const slot = view.querySelector("[data-ask-slot]");
  slot.innerHTML = String(askPanel("country", ctx));
  bindAsk(slot, "country", ctx, () => {
    renderAsk(view, ctx);
    updateMap(view, ctx);
  });
}

export function update(view, ctx) {
  updateMap(view, ctx);
  view.querySelector("[data-live]").innerHTML = String(live(ctx));
}

export { raw };
