// Level 2: Aachen. The hourly city model on a schematic road network: each street direction
// coloured by load, the planner's scenario workbench, and the corridors that open level 3.

import { CORRIDORS, NODE_BY_ID, NODES, ZONES } from "../data/aachen.js";
import { BASE_SCENARIO, edgeOf, LINK_INDEX, links } from "../engine/city.js";
import { corridorDefs } from "../engine/twin.js";
import { askHighlight, askPanel, bindAsk } from "./ask.js";
import { chip, fidelityCard, hourBars, html, int, kmh, LOAD_LABEL, loadColor, loadTone, meter, pct, raw } from "./dom.js";

const W = 960;
const H = 700;
const OFFSET = 2.6; // px between the two directions of a street
// Where each corridor's "street twin" tag sits, relative to the corridor's last node.
const TAG_OFFSET = { julicher: [60, -34], campus: [-70, 22] };
let geo = null;

const corridorOfLink = {};
for (const def of Object.values(corridorDefs)) for (const l of def.links) corridorOfLink[l.id] = def.id;

/**
 * A fisheye layout: distances from the Markt are compressed (r^0.55), so the ring and the old
 * town get room while the motorway gateways still fit. A schematic map, like a transit diagram.
 */
function geometry() {
  if (geo) return geo;
  const c = NODE_BY_ID.markt;
  const kx = 111.32 * Math.cos((c.lat * Math.PI) / 180);
  const warped = Object.fromEntries(
    NODES.map((n) => {
      const x = (n.lon - c.lon) * kx;
      const y = -(n.lat - c.lat) * 110.57;
      const r = Math.hypot(x, y);
      const f = r > 0 ? r ** 0.55 / r : 0;
      return [n.id, [x * f, y * f]];
    }),
  );
  const xs = Object.values(warped).map((p) => p[0]);
  const ys = Object.values(warped).map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = { l: 120, r: 120, t: 40, b: 40 };
  const k = Math.min((W - pad.l - pad.r) / (x1 - x0), (H - pad.t - pad.b) / (y1 - y0));
  const ox = pad.l + (W - pad.l - pad.r - k * (x1 - x0)) / 2;
  const oy = pad.t + (H - pad.t - pad.b - k * (y1 - y0)) / 2;
  const xy = Object.fromEntries(Object.entries(warped).map(([id, [x, y]]) => [id, [ox + (x - x0) * k, oy + (y - y0) * k]]));
  geo = { xy };
  return geo;
}

/** Endpoints of one street direction, shifted to its right-hand side. */
function sideLine(a, b, side) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * OFFSET * side;
  const ny = (dx / len) * OFFSET * side;
  return [a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny];
}

function mapSvg() {
  const { xy } = geometry();
  const zoneR = (z) => Math.sqrt(z.pop + z.jobs) / 7;
  return html`<svg class="map map-city" viewBox="0 0 ${W} ${H}" role="img" aria-label="Aachen road network coloured by load">
    <g class="zones">
      ${ZONES.map((z) => {
        const [x, y] = xy[z.node];
        return html`<g class="zone"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${zoneR(z).toFixed(1)}" /><text x="${x.toFixed(1)}" y="${(y + zoneR(z) + 12).toFixed(1)}" text-anchor="middle">${z.name}</text></g>`;
      })}
    </g>
    <g class="corridor-halos">
      ${Object.values(corridorDefs).flatMap((def) =>
        def.links.map((l) => {
          const a = xy[l.from];
          const b = xy[l.to];
          return html`<line class="corridor-halo" data-go="${def.id}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"><title>${def.name}: open the street-level twin</title></line>`;
        }),
      )}
    </g>
    <g class="links">
      ${links.map((l) => {
        const a = xy[l.from];
        const b = xy[l.to];
        const f = sideLine(a, b, 1);
        const r = sideLine(b, a, 1);
        return html`<g class="link cls-${l.cls}" data-link="${l.id}" tabindex="0" role="button" aria-label="${l.name}, ${NODE_BY_ID[l.from].name} to ${NODE_BY_ID[l.to].name}">
          <line class="link-hit" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" />
          <line class="link-sel" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" />
          <line class="dir dir-0" x1="${f[0]}" y1="${f[1]}" x2="${f[2]}" y2="${f[3]}" />
          <line class="dir dir-1" x1="${r[0]}" y1="${r[1]}" x2="${r[2]}" y2="${r[3]}" />
          <line class="link-closed" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" />
          <title>${l.name}</title>
        </g>`;
      })}
    </g>
    <g class="nodes">
      ${NODES.map((n) => {
        const [x, y] = xy[n.id];
        const label = n.kind !== "inner";
        const anchor = n.kind === "gateway" ? (x < W / 2 ? "end" : "start") : "start";
        const dx = n.kind === "gateway" ? (x < W / 2 ? -8 : 8) : 7;
        return html`<g class="node kind-${n.kind}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <circle r="${n.kind === "gateway" ? 4 : n.kind === "motorway" ? 3.5 : 3}" />
          ${label ? html`<text x="${dx}" y="-6" text-anchor="${anchor}">${n.name}</text>` : ""}
        </g>`;
      })}
    </g>
    <g class="corridor-tags">
      ${CORRIDORS.map((c) => {
        const def = corridorDefs[c.id];
        const end = xy[def.nodes.at(-1)];
        const [dx, dy] = TAG_OFFSET[c.id] ?? [12, 24];
        const width = c.name.length * 7 + 96;
        const x = end[0] + dx - (dx < 0 ? width : 0);
        const y = end[1] + dy;
        return html`<g class="corridor-tag" data-go="${c.id}" tabindex="0" role="link" aria-label="Open the street-level twin of ${c.name}">
          <line x1="${end[0]}" y1="${end[1]}" x2="${(dx < 0 ? x + width : x).toFixed(1)}" y2="${(y - 3).toFixed(1)}" />
          <g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
            <rect x="0" y="-13" width="${width}" height="20" rx="10" />
            <text x="10" y="1">${c.name} · street twin →</text>
          </g>
        </g>`;
      })}
    </g>
  </svg>`;
}

function updateMap(root, ctx) {
  const { twin, ui } = ctx;
  const flows = twin.city.flowsAt(twin.dayTime, twin.scenario);
  const hl = new Set(askHighlight(ui, "city").links ?? []);
  const closed = new Set(twin.scenario.closed);
  const bus = new Set(twin.scenario.busLanes);
  for (const el of root.querySelectorAll(".link")) {
    const l = links[LINK_INDEX[el.dataset.link]];
    [0, 1].forEach((d) => {
      const e = 2 * l.index + d;
      const line = el.querySelector(`.dir-${d}`);
      line.style.stroke = closed.has(l.id) ? "var(--ink-3)" : loadColor(flows.vc[e]);
      line.style.strokeWidth = `${(1.4 + (flows.flow[e] || 0) / 650).toFixed(2)}px`;
    });
    el.classList.toggle("is-closed", closed.has(l.id));
    el.classList.toggle("is-bus", bus.has(l.id));
    el.classList.toggle("is-hl", hl.has(l.id));
    el.classList.toggle("is-sel", ui.sel.link === l.id);
  }
}

function linkCard(ctx) {
  const { twin, ui } = ctx;
  const l = ui.sel.link ? links[LINK_INDEX[ui.sel.link]] : null;
  if (!l) return html`<p class="muted small hint">Click a street to see both directions, close it or give it a bus lane. Outlined streets open the street-level twin.</p>`;
  const flows = twin.city.flowsAt(twin.dayTime, twin.scenario);
  const corridor = corridorOfLink[l.id];
  const sensed = corridor ? twin.calibration().filter((r) => r.link === l.id) : [];
  const closed = twin.scenario.closed.includes(l.id);
  const bus = twin.scenario.busLanes.includes(l.id);
  const worst = Math.max(flows.vc[2 * l.index], flows.vc[2 * l.index + 1]);
  return html`<section class="card" aria-label="Selected street">
    <div class="row between"><h3>${l.name}</h3>${closed ? chip("Closed", "crit") : chip(LOAD_LABEL[loadTone(worst)], loadTone(worst))}</div>
    <p class="muted small">${NODE_BY_ID[l.from].name} – ${NODE_BY_ID[l.to].name} · ${l.label} · ${(l.km).toFixed(1)} km · ${int(l.cap)} veh/h per direction</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Direction</th><th class="num">Veh/h</th><th class="num">Load</th><th class="num">Speed</th>${corridor ? html`<th class="num">Sensors</th>` : ""}</tr></thead>
      <tbody>
        ${[0, 1].map((d) => {
          const e = 2 * l.index + d;
          const [a, b] = d === 0 ? [l.from, l.to] : [l.to, l.from];
          const s = sensed.find((r) => r.from === NODE_BY_ID[a].name);
          return html`<tr><td>→ ${NODE_BY_ID[b].name}</td><td class="num">${closed ? "—" : int(flows.flow[e])}</td><td class="num">${closed ? "—" : pct(flows.vc[e])}</td><td class="num">${closed ? "—" : kmh(flows.speed[e])}</td>${
            corridor ? html`<td class="num">${s && s.minutes >= 3 ? int(s.sensed) : "…"}</td>` : ""
          }</tr>`;
        })}
      </tbody>
    </table></div>
    ${corridor ? html`<p class="small muted">Sensors: vehicles per hour counted by the street-level twin's loop counters over the last 15 minutes.</p>` : ""}
    <div class="row">
      <button class="btn${closed ? " btn-ok" : " btn-danger"}" data-act="close" data-link="${l.id}">${closed ? "Reopen" : "Close for roadworks"}</button>
      ${l.cls !== "motorway" ? html`<button class="btn" data-act="bus" data-link="${l.id}" aria-pressed="${bus}">${bus ? "Remove bus lane" : "Add bus lane"}</button>` : ""}
      ${corridor ? html`<a class="btn btn-primary" href="#${corridor}">Street twin →</a>` : ""}
    </div>
  </section>`;
}

function scenarioCard(ctx) {
  const { twin } = ctx;
  const s = twin.scenario;
  const active = s.closed.length || s.busLanes.length || s.zone30 || s.demand !== 1;
  const base = twin.city.day(BASE_SCENARIO).totals;
  const now = twin.city.day(s).totals;
  const delta = (a, b) => (b - a) / a;
  return html`<section class="card scenario" aria-label="Scenario workbench">
    <div class="row between"><h3>Scenario workbench</h3>${active ? chip("Scenario active", "accent") : chip("Today's network", "", { plain: true })}</div>
    <div class="row">
      <button class="btn" data-act="zone30" aria-pressed="${s.zone30}">30 km/h inside the ring</button>
      <label class="row small">Car demand
        <select class="select select-inline" data-act="demand" aria-label="Car demand">
          ${[1, 0.95, 0.9, 0.8, 0.7, 1.1].map((f) => html`<option value="${f}"${Math.abs(f - s.demand) < 1e-6 ? raw(" selected") : ""}>${f === 1 ? "as today" : `${f > 1 ? "+" : "−"}${Math.round(Math.abs(1 - f) * 100)}%`}</option>`)}
        </select>
      </label>
    </div>
    ${
      s.closed.length || s.busLanes.length
        ? html`<ul class="scenario-list">
            ${s.closed.map((id) => html`<li>${chip("Closed", "crit")} ${links[LINK_INDEX[id]].name} <button class="btn btn-ghost" data-act="close" data-link="${id}">reopen</button></li>`)}
            ${s.busLanes.map((id) => html`<li>${chip("Bus lane", "accent")} ${links[LINK_INDEX[id]].name} <button class="btn btn-ghost" data-act="bus" data-link="${id}">remove</button></li>`)}
          </ul>`
        : ""
    }
    ${
      active
        ? html`<dl class="kv">
            <dt>Time in traffic vs today</dt><dd>${signedPct(delta(base.vht, now.vht))}</dd>
            <dt>Distance driven</dt><dd>${signedPct(delta(base.vkt, now.vkt))}</dd>
            <dt>CO2</dt><dd>${signedPct(delta(base.co2Kg, now.co2Kg))}</dd>
          </dl>
          <div class="row"><button class="btn btn-ghost" data-act="reset">Back to today's network</button></div>`
        : html`<p class="small muted">Changes apply to the whole twin: the street-level corridors receive the new flows too.</p>`
    }
  </section>`;
}

const signedPct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${(Math.abs(x) * 100).toFixed(1)}%`;

function live(ctx) {
  const { twin } = ctx;
  const r = twin.city.hour(twin.hour, twin.scenario);
  const day = twin.city.day(twin.scenario);
  const delay = day.hours.map((h) => h.totals.delayH);
  return html`
    <section class="card">
      <div class="eyebrow">This hour, ${String(twin.hour).padStart(2, "0")}:00–${String((twin.hour + 1) % 24).padStart(2, "0")}:00</div>
      <div class="grid-3 stats">
        <div class="stat"><span class="stat-value">${int(r.totals.trips)}</span><span class="stat-label">vehicle trips</span></div>
        <div class="stat"><span class="stat-value">${int(r.totals.delayH)} h</span><span class="stat-label">delay vs empty roads</span></div>
        <div class="stat"><span class="stat-value">${(r.totals.co2Kg / 1000).toFixed(1)} t</span><span class="stat-label">CO2</span></div>
      </div>
      <div class="eyebrow">Delay over the day · click an hour to go there</div>
      ${hourBars(delay, { mark: twin.hour, label: "Delay per hour", onClickAttr: "data-jump-hour" })}
    </section>
    ${linkCard(ctx)}`;
}

export function mount(view, ctx) {
  view.innerHTML = String(html`
    <div class="view-head">
      <div>
        <h1>Aachen · city traffic model</h1>
        <p>Level 2. An hourly model of the whole city answers planning questions. Traffic from the motorways comes from level 1; the outlined corridors open level 3, where single vehicles are simulated.</p>
      </div>
      <div class="legend" aria-label="Legend">
        <span><i class="swatch" style="background:var(--ok)"></i>free</span>
        <span><i class="swatch" style="background:var(--warn)"></i>busy</span>
        <span><i class="swatch" style="background:var(--crit)"></i>congested</span>
        <span>one line per direction, width = vehicles/h</span>
      </div>
    </div>
    <div class="layout">
      <div class="stage card card-flush map-wrap">${mapSvg()}</div>
      <aside class="panel">
        ${fidelityCard({
          level: 2,
          title: "Aachen · hourly model",
          data: "Population and jobs per district, road capacities, motorway volumes from level 1",
          resolution: "Street link (1–8 km), one hour, both directions",
          update: "Recomputed for every hour and every scenario",
          feeds: [
            { dir: "up", text: "Gateway volumes come from the Germany statistics (A4, A44)." },
            { dir: "down", text: "Hourly flows on Jülicher Straße and the campus corridor drive the street simulations." },
            { dir: "up", text: "Street sensors report back how well the model matches." },
          ],
        })}
        <div data-live></div>
        <div data-scenario></div>
        <div data-ask-slot></div>
      </aside>
    </div>`);

  const map = view.querySelector(".map-city");
  const pick = (el) => {
    ctx.ui.sel.link = ctx.ui.sel.link === el.dataset.link ? null : el.dataset.link;
    update(view, ctx);
  };
  map.addEventListener("click", (e) => {
    const el = e.target.closest(".link");
    if (el) pick(el);
  });
  map.addEventListener("keydown", (e) => {
    const el = e.target.closest(".link");
    if (el && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      pick(el);
    }
  });

  const act = (el) => {
    const { twin } = ctx;
    const s = twin.scenario;
    const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    if (el.dataset.act === "close") twin.setScenario({ closed: toggle(s.closed, el.dataset.link) });
    if (el.dataset.act === "bus") twin.setScenario({ busLanes: toggle(s.busLanes, el.dataset.link) });
    if (el.dataset.act === "zone30") twin.setScenario({ zone30: !s.zone30 });
    if (el.dataset.act === "reset") twin.resetScenario();
    renderScenario(view, ctx);
    update(view, ctx);
    ctx.onTwinChange();
  };
  view.querySelector(".panel").addEventListener("click", (e) => {
    const el = e.target.closest("button[data-act]");
    if (el) act(el);
    const bar = e.target.closest("[data-jump-hour]");
    if (bar) {
      ctx.twin.setTime(Number(bar.dataset.jumpHour) * 3600 + 30 * 60);
      ctx.onTwinChange();
    }
  });
  view.querySelector(".panel").addEventListener("change", (e) => {
    if (e.target.matches("select[data-act=demand]")) {
      ctx.twin.setScenario({ demand: Number(e.target.value) });
      renderScenario(view, ctx);
      update(view, ctx);
      ctx.onTwinChange();
    }
  });
  renderScenario(view, ctx);
  renderAsk(view, ctx);
  update(view, ctx);
}

function renderScenario(view, ctx) {
  view.querySelector("[data-scenario]").innerHTML = String(scenarioCard(ctx));
}

function renderAsk(view, ctx) {
  const slot = view.querySelector("[data-ask-slot]");
  slot.innerHTML = String(askPanel("city", ctx));
  bindAsk(slot, "city", ctx, () => {
    renderAsk(view, ctx);
    renderScenario(view, ctx);
    updateMap(view, ctx);
  });
}

export function update(view, ctx) {
  updateMap(view, ctx);
  view.querySelector("[data-live]").innerHTML = String(live(ctx));
}

export { edgeOf };
