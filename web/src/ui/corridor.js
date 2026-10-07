// Levels 3 and 4: one corridor, vehicle by vehicle. The overview strip shows the whole street
// (both directions, two lanes each); a junction view (level 4) zooms in on one signal and shows
// what its roadside sensor mast detects. Both are canvases redrawn every animation frame.

import { askPanel, bindAsk } from "./ask.js";
import { chip, fidelityCard, html, int, kmh, raw } from "./dom.js";

const LANE_PX = 8;
const MEDIAN_PX = 4;
const OVERVIEW_H = 160;
const DETAIL_H = 320;
const DETAIL_HALF_M = 140;
const NARROW = 600; // canvas width (px) below which labels and the close-up shrink

const css = () => {
  const s = getComputedStyle(document.documentElement);
  const v = (n) => s.getPropertyValue(n).trim();
  return {
    ok: v("--ok"),
    warn: v("--warn"),
    crit: v("--crit"),
    road: v("--road"),
    roadLine: v("--road-line"),
    edge: v("--road-edge"),
    ink: v("--ink"),
    ink2: v("--ink-2"),
    ink3: v("--ink-3"),
    accent: v("--accent"),
    accentSoft: v("--accent-soft"),
    surface: v("--surface"),
    land: v("--map-land"),
    font: v("--font-body"),
    mono: v("--font-mono"),
  };
};

const speedColor = (c, veh) => {
  const r = veh.v / veh.v0;
  return r < 0.25 ? c.crit : r < 0.6 ? c.warn : c.ok;
};
const SIG_COLOR = (c, s) => (s === "green" ? c.ok : s === "amber" ? c.warn : c.crit);

function fitCanvas(canvas, height) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h: height };
}

// -- overview strip -------------------------------------------------------------------------
function drawOverview(canvas, sim, ui) {
  const { g, w, h } = fitCanvas(canvas, OVERVIEW_H);
  const c = css();
  const pad = 28;
  const L = sim.L;
  const X = (x) => pad + (x / L) * (w - 2 * pad);
  const top = 58;
  const laneY = (d, lane) => (d === 1 ? top + (lane === 0 ? 0 : LANE_PX) : top + 2 * LANE_PX + MEDIAN_PX + (lane === 1 ? 0 : LANE_PX));
  const bottom = top + 4 * LANE_PX + MEDIAN_PX;
  g.clearRect(0, 0, w, h);
  g.font = `11px ${c.font}`;

  // City links the corridor follows, labelled above.
  g.fillStyle = c.ink3;
  g.textAlign = "center";
  const narrow = w < NARROW;
  for (const l of sim.def.links) g.fillText(narrow ? `city link ${l.id}` : `${l.name} (city link ${l.id})`, X((l.x0 + l.x1) / 2), 14);

  // Sensor coverage bands.
  sim.def.stations.forEach((st, i) => {
    if (!st.signal) return;
    g.fillStyle = sim.health[i] === "ok" ? c.accentSoft : c.crit;
    g.globalAlpha = sim.health[i] === "ok" ? 0.8 : 0.18;
    g.fillRect(X(st.x - 110), top - 6, X(st.x + 110) - X(st.x - 110), bottom - top + 12);
    g.globalAlpha = 1;
  });

  // Road.
  g.fillStyle = c.road;
  g.fillRect(X(0), top, X(L) - X(0), 2 * LANE_PX);
  g.fillRect(X(0), top + 2 * LANE_PX + MEDIAN_PX, X(L) - X(0), 2 * LANE_PX);
  g.strokeStyle = c.roadLine;
  g.setLineDash([4, 5]);
  g.lineWidth = 1;
  for (const y of [top + LANE_PX, top + 3 * LANE_PX + MEDIAN_PX]) {
    g.beginPath();
    g.moveTo(X(0), y);
    g.lineTo(X(L), y);
    g.stroke();
  }
  g.setLineDash([]);

  // Incidents.
  for (const inc of sim.incidents) {
    const y = laneY(inc.d, inc.lane);
    g.fillStyle = c.crit;
    g.fillRect(X(inc.x) - 4, y - 1, 8, LANE_PX + 2);
  }

  // Vehicles.
  for (const v of sim.vehicles()) {
    const x = sim.xOf(v);
    const rear = v.d === 0 ? x - v.len : x + v.len;
    const x0 = Math.min(X(x), X(rear));
    const wpx = Math.max(2.5, Math.abs(X(x) - X(rear)));
    g.fillStyle = speedColor(c, v);
    g.fillRect(x0, laneY(v.d, v.lane) + 1.5, wpx, LANE_PX - 3);
  }

  // Stations: names, signals, masts.
  sim.def.stations.forEach((st, i) => {
    const x = X(st.x);
    g.strokeStyle = c.ink3;
    g.beginPath();
    g.moveTo(x, top - 10);
    g.lineTo(x, bottom + 10);
    g.stroke();
    g.fillStyle = ui.sel.station === i ? c.accent : c.ink;
    g.font = `${ui.sel.station === i ? 600 : 500} 11px ${c.font}`;
    g.textAlign = i === 0 ? "left" : i === sim.def.stations.length - 1 ? "right" : "center";
    g.fillText(st.name.replace(/^Junction /, ""), x, bottom + 24 + (i % (narrow ? 3 : 2)) * 13);
    const sig = sim.signal(i);
    if (sig) {
      g.fillStyle = SIG_COLOR(c, sig.state);
      g.beginPath();
      g.arc(X(st.x + 8), top - 14, 4, 0, 2 * Math.PI); // direction 1 stops east of the junction
      g.arc(X(st.x - 8), bottom + 8, 4, 0, 2 * Math.PI);
      g.fill();
      g.fillStyle = sim.health[i] === "ok" ? c.accent : c.crit;
      g.beginPath();
      g.moveTo(x - 4, top - 24);
      g.lineTo(x + 4, top - 24);
      g.lineTo(x, top - 31);
      g.fill();
    }
  });

  // Direction labels.
  g.font = `11px ${c.font}`;
  g.fillStyle = c.ink2;
  g.textAlign = "left";
  g.fillText("←", 6, top + LANE_PX + 4);
  g.fillText("→", w - 18, top + 3 * LANE_PX + MEDIAN_PX + 4);
}

// -- junction detail (level 4) ----------------------------------------------------------------
function drawDetail(canvas, sim, i) {
  const narrow = canvas.clientWidth < NARROW;
  const { g, w, h } = fitCanvas(canvas, narrow ? 240 : DETAIL_H);
  const c = css();
  const st = sim.def.stations[i];
  const half = narrow ? 60 : DETAIL_HALF_M;
  const scale = w / (2 * half);
  const X = (x) => w / 2 + (x - st.x) * scale;
  const laneM = 3.5;
  const medianM = 1.5;
  const roadM = 4 * laneM + medianM;
  const cy = h / 2;
  const yTop = cy - (roadM / 2) * scale;
  const laneTop = (d, lane) => (d === 1 ? yTop + (lane === 0 ? 0 : laneM) * scale : yTop + (2 * laneM + medianM + (lane === 1 ? 0 : laneM)) * scale);
  g.clearRect(0, 0, w, h);
  g.fillStyle = c.land;
  g.globalAlpha = 0.35;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 1;

  // Side street.
  g.fillStyle = c.road;
  g.fillRect(X(st.x - 4), 0, 8 * scale, h);
  // Main road.
  g.fillRect(0, yTop, w, 2 * laneM * scale);
  g.fillRect(0, yTop + (2 * laneM + medianM) * scale, w, 2 * laneM * scale);
  g.strokeStyle = c.roadLine;
  g.lineWidth = 1;
  g.setLineDash([8, 10]);
  for (const y of [yTop + laneM * scale, yTop + (3 * laneM + medianM) * scale]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(X(st.x - 4), y);
    g.moveTo(X(st.x + 4), y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.setLineDash([]);
  // Stop lines.
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(X(st.x - 8), laneTop(0, 1));
  g.lineTo(X(st.x - 8), laneTop(0, 0) + laneM * scale);
  g.moveTo(X(st.x + 8), laneTop(1, 0));
  g.lineTo(X(st.x + 8), laneTop(1, 1) + laneM * scale);
  g.stroke();
  g.lineWidth = 1;

  // Sensor coverage.
  const mast = sim.mast(i);
  const mx = X(st.x + 12);
  const my = yTop - 18;
  g.strokeStyle = mast.health === "ok" ? c.accent : c.crit;
  g.setLineDash([6, 6]);
  g.beginPath();
  g.arc(mx, my, mast.range * scale, 0, 2 * Math.PI);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = mast.health === "ok" ? c.accent : c.crit;
  g.beginPath();
  g.arc(mx, my, 6, 0, 2 * Math.PI);
  g.fill();
  g.font = `600 11px ${c.font}`;
  g.textAlign = "left";
  g.fillText(mast.health === "ok" ? "Sensor mast" : "Sensor mast · degraded", mx + 10, my - 6);

  // Incidents.
  for (const inc of sim.incidents) {
    if (Math.abs(inc.x - st.x) > half) continue;
    const y = laneTop(inc.d, inc.lane);
    g.fillStyle = c.crit;
    g.fillRect(X(inc.x) - 3 * scale, y + 0.4 * scale, 6 * scale, (laneM - 0.8) * scale);
    g.fillStyle = c.surface;
    g.font = `700 ${Math.max(9, 2.2 * scale)}px ${c.font}`;
    g.textAlign = "center";
    g.fillText("!", X(inc.x), y + laneM * scale * 0.72);
  }

  // Vehicles (truth), then the mast's detections (outlines, with sensor noise).
  for (const v of sim.vehicles()) {
    const x = sim.xOf(v);
    if (Math.abs(x - st.x) > half + 15) continue;
    const rear = v.d === 0 ? x - v.len : x + v.len;
    const y = laneTop(v.d, v.lane) + 0.8 * scale;
    g.fillStyle = speedColor(c, v);
    g.fillRect(Math.min(X(x), X(rear)), y, Math.abs(X(x) - X(rear)), 1.9 * scale);
    if (v.cv) {
      g.fillStyle = c.surface;
      g.beginPath();
      g.arc((X(x) + X(rear)) / 2, y + 0.95 * scale, Math.max(1.5, 0.45 * scale), 0, 2 * Math.PI);
      g.fill();
    }
  }
  g.strokeStyle = c.accent;
  g.lineWidth = 1.2;
  for (const det of mast.detections) {
    const rear = det.d === 0 ? det.x - det.len : det.x + det.len;
    const y = laneTop(det.d, det.lane) + 0.4 * scale;
    g.strokeRect(Math.min(X(det.x), X(rear)) - 1, y, Math.abs(X(det.x) - X(rear)) + 2, 2.7 * scale);
  }

  // Signal heads.
  const sig = sim.signal(i);
  if (sig) {
    for (const [x, y] of [
      [X(st.x - 8) - 10, laneTop(0, 0) + laneM * scale + 12],
      [X(st.x + 8) + 10, laneTop(1, 0) - 12],
    ]) {
      g.fillStyle = c.edge;
      g.fillRect(x - 6, y - 6, 12, 12);
      g.fillStyle = SIG_COLOR(c, sig.state);
      g.beginPath();
      g.arc(x, y, 4, 0, 2 * Math.PI);
      g.fill();
    }
  }

  // Side-street queues and direction labels.
  g.font = `11px ${c.font}`;
  g.fillStyle = c.ink2;
  g.textAlign = "left";
  const side = Math.floor(sim.sideQueue[0][i] + sim.sideQueue[1][i]);
  g.fillText(`Side street: ${side} waiting to turn in`, narrow ? 8 : X(st.x + 6), h - 10);
  const names = [sim.def.stations.at(-1).name, sim.def.stations[0].name];
  g.fillText(`→ towards ${names[0]}`, 8, laneTop(0, 0) + laneM * scale + 18);
  g.textAlign = "right";
  g.fillText(`← towards ${names[1]}`, w - 8, yTop - 8);
}

// -- panel ----------------------------------------------------------------------------------------
function dirStats(sim) {
  const st = sim.def.stations;
  const last = st.length - 1;
  return [0, 1].map((d) => {
    const s = sim.directionStats(d);
    const tt = d === 0 ? sim.travelTime(0, last) : sim.travelTime(last, 0);
    return { d, ...s, tt, label: `→ ${d === 0 ? st[last].name : st[0].name}` };
  });
}

function live(ctx, sim, station) {
  const st = sim.def.stations;
  const stats = dirStats(sim);
  const mast = station !== null ? sim.mast(station) : null;
  const sig = station !== null ? sim.signal(station) : null;
  return html`
    <section class="card">
      <div class="eyebrow">Right now, ${ctx.twin.clock}</div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Direction</th><th class="num">Vehicles</th><th class="num">Mean speed</th><th class="num">End to end</th></tr></thead>
        <tbody>${stats.map(
          (s) => html`<tr><td>${s.label}</td><td class="num">${s.vehicles}</td><td class="num">${kmh(s.meanKmh)}</td><td class="num">${(s.tt.seconds / 60).toFixed(1)} min${s.tt.method === "estimated" ? "*" : ""}</td></tr>`,
        )}</tbody>
      </table></div>
      ${stats.some((s) => s.waitingToEnter > 5) ? html`<p class="small warn-text">${stats.filter((s) => s.waitingToEnter > 5).map((s) => `${s.waitingToEnter} vehicles backed up before the corridor (${s.label}).`).join(" ")}</p>` : ""}
      ${sim.incidents.length ? html`<p class="small warn-text">${sim.incidents.length} lane${sim.incidents.length > 1 ? "s" : ""} blocked.</p>` : ""}
    </section>
    ${
      mast
        ? html`<section class="card" aria-label="Sensor mast">
            <div class="row between"><h3>Mast at ${mast.name}</h3>${mast.health === "ok" ? chip("Healthy", "ok") : chip("Degraded", "crit")}</div>
            <dl class="kv">
              <dt>Signal (this street)</dt><dd>${chip(`${sig.state} · ${Math.round(sig.toChange)} s`, sig.state === "green" ? "ok" : sig.state === "amber" ? "warn" : "crit")}</dd>
              <dt>Objects detected</dt><dd>${mast.detections.length} within ${mast.range} m</dd>
              <dt>Connected vehicles</dt><dd>${mast.detections.filter((d) => d.cv).length}</dd>
              <dt>Mean speed seen</dt><dd>${kmh(mast.meanKmh)}</dd>
              <dt>Queue → ${st.at(-1).name}</dt><dd>${mast.queue[0].vehicles} veh · ${int(mast.queue[0].metres)} m</dd>
              <dt>Queue → ${st[0].name}</dt><dd>${mast.queue[1].vehicles} veh · ${int(mast.queue[1].metres)} m</dd>
              <dt>V2X out</dt><dd>SPaT 10 Hz · CPM ${mast.cpmPerSecond} Hz</dd>
            </dl>
            <p class="small muted">Outlined boxes are what the mast detects (with its position error). Filled shapes are the simulated truth. White dots mark connected (V2X) vehicles.</p>
          </section>`
        : ""
    }`;
}

function junctionCards(ctx, sim) {
  const id = sim.def.id;
  return html`<div class="junctions">
    ${sim.def.stations.map((st, i) => {
      const sig = sim.signal(i);
      if (!sig) return "";
      const m = sim.mast(i);
      const q = Math.max(m.queue[0].vehicles, m.queue[1].vehicles);
      return html`<a class="card junction-card" href="#${id}.j${i}">
        <div class="row between"><strong>${st.name}</strong>${chip(sig.state, sig.state === "green" ? "ok" : sig.state === "amber" ? "warn" : "crit")}</div>
        <span class="small muted">${q} queued · ${m.detections.length} seen · mast ${m.health}</span>
      </a>`;
    })}
  </div>`;
}

function eventsCard(sim, station) {
  const st = sim.def.stations;
  const signals = st.map((s, i) => ({ s, i })).filter((x) => x.s.signal);
  const at = station ?? signals[0].i;
  return html`<section class="card events" aria-label="Street events">
    <h3>Make something happen</h3>
    <p class="small muted">Rare events the twin should cope with. Watch the queues grow and ask the driver questions.</p>
    <div class="row">
      <label class="small">Near
        <select class="select select-inline" data-ev="at">${signals.map((x) => html`<option value="${x.i}"${x.i === at ? raw(" selected") : ""}>${x.s.name}</option>`)}</select>
      </label>
      <label class="small">Direction
        <select class="select select-inline" data-ev="dir"><option value="0">→ ${st.at(-1).name}</option><option value="1">→ ${st[0].name}</option></select>
      </label>
    </div>
    <div class="row">
      <button class="btn btn-danger" data-ev-act="block">Block a lane (20 min)</button>
      <button class="btn" data-ev-act="tamper">Tamper with sensor mast</button>
      <button class="btn btn-ghost" data-ev-act="clear">Clear all</button>
    </div>
  </section>`;
}

// -- mount / update / frame ----------------------------------------------------------------------
export function mount(view, ctx) {
  const sim = ctx.twin.corridors[ctx.route.corridor];
  const station = ctx.route.station ?? null;
  ctx.ui.sel.station = station;
  const st = station !== null ? sim.def.stations[station] : null;
  view.innerHTML = String(html`
    <div class="view-head">
      <div>
        <h1>${st ? `${st.name} · junction` : `${sim.def.name} · street twin`}</h1>
        <p>${
          st
            ? "Level 4. One junction as its roadside sensor mast sees it: every vehicle, the signal, the queues. This is what a driver's questions are answered from."
            : `Level 3. ${sim.def.blurb} Every vehicle is simulated; how many enter comes from the city model, what the sensors count goes back up to it.`
        }</p>
      </div>
      <div class="legend" aria-label="Legend">
        <span><i class="swatch" style="background:var(--ok)"></i>moving</span>
        <span><i class="swatch" style="background:var(--warn)"></i>slow</span>
        <span><i class="swatch" style="background:var(--crit)"></i>stopped</span>
        <span><i class="swatch" style="background:var(--accent-soft);outline:1px solid var(--accent)"></i>sensor coverage</span>
      </div>
    </div>
    <div class="layout">
      <div class="stage stack">
        <div class="card canvas-card">
          <canvas class="overview" height="${OVERVIEW_H}" aria-label="All vehicles on ${sim.def.name}, both directions" role="img"></canvas>
        </div>
        ${
          st
            ? html`<div class="card canvas-card">
                <canvas class="detail" height="${DETAIL_H}" aria-label="Close-up of ${st.name} with sensor detections" role="img"></canvas>
              </div>
              <nav class="row junction-tabs" aria-label="Junctions">
                ${sim.def.stations.map((s, i) => (s.signal ? html`<a class="btn${i === station ? " btn-primary" : ""}" href="#${sim.def.id}.j${i}"${i === station ? raw(' aria-current="page"') : ""}>${s.name}</a>` : ""))}
              </nav>`
            : html`<div data-junctions></div>`
        }
        <div data-events>${eventsCard(sim, station)}</div>
      </div>
      <aside class="panel">
        ${
          st
            ? fidelityCard({
                level: 4,
                title: "Junction · sensor view",
                data: "Roadside mast (camera + lidar) detections, signal phase and timing",
                resolution: "Each vehicle, ±0.4 m, 10 times a second",
                update: "Continuously, while the mast is healthy",
                feeds: [
                  { dir: "up", text: "Queues and detections feed the corridor's travel times." },
                  { dir: "down", text: "Signal timing and detected objects go to connected vehicles (SPaT, CPM)." },
                ],
              })
            : fidelityCard({
                level: 3,
                title: "Corridor · vehicle simulation",
                data: "Car-following simulation fed by the city model; loop counters and sensor masts",
                resolution: "Each vehicle, every half second, two lanes per direction",
                update: "Continuously; inflows refreshed from the city model every minute",
                feeds: [
                  { dir: "up", text: "How many vehicles enter comes from the Aachen model's hourly flows." },
                  { dir: "up", text: "Loop-counter flows go back up to check the city model." },
                ],
              })
        }
        <div data-live></div>
        <div data-ask-slot></div>
      </aside>
    </div>`);

  view.querySelector("[data-events]").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ev-act]");
    if (!btn) return;
    const box = view.querySelector("[data-events]");
    const at = Number(box.querySelector("[data-ev=at]").value);
    const d = Number(box.querySelector("[data-ev=dir]").value);
    const x = sim.def.stations[at].x + (d === 0 ? -45 : 45);
    if (btn.dataset.evAct === "block") {
      ctx.twin.addIncident(sim.def.id, { d, lane: 0, x, minutes: 20 });
      ctx.toast(`A broken-down vehicle blocks the right lane before ${sim.def.stations[at].name}.`);
    }
    if (btn.dataset.evAct === "tamper") {
      const next = sim.health[at] === "ok" ? "degraded" : "ok";
      ctx.twin.setMastHealth(sim.def.id, at, next);
      ctx.toast(next === "ok" ? `The mast at ${sim.def.stations[at].name} is repaired.` : `The mast at ${sim.def.stations[at].name} is tampered with: it now misses most vehicles.`);
    }
    if (btn.dataset.evAct === "clear") {
      ctx.twin.clearIncidents(sim.def.id);
      sim.health.forEach((_, i) => ctx.twin.setMastHealth(sim.def.id, i, "ok"));
      ctx.toast("All lanes are open and every mast is healthy.");
    }
    update(view, ctx);
  });

  renderAsk(view, ctx);
  update(view, ctx);
  frame(view, ctx);
}

function renderAsk(view, ctx) {
  const slot = view.querySelector("[data-ask-slot]");
  const askCtx = { ...ctx, corridor: ctx.route.corridor };
  slot.innerHTML = String(askPanel("corridor", askCtx));
  bindAsk(slot, "corridor", askCtx, () => renderAsk(view, ctx));
}

export function update(view, ctx) {
  const sim = ctx.twin.corridors[ctx.route.corridor];
  const station = ctx.route.station ?? null;
  view.querySelector("[data-live]").innerHTML = String(live(ctx, sim, station));
  const j = view.querySelector("[data-junctions]");
  if (j) j.innerHTML = String(junctionCards(ctx, sim));
}

export function frame(view, ctx) {
  const sim = ctx.twin.corridors[ctx.route.corridor];
  const ov = view.querySelector("canvas.overview");
  if (ov) drawOverview(ov, sim, ctx.ui);
  const det = view.querySelector("canvas.detail");
  if (det && ctx.route.station !== undefined) drawDetail(det, sim, ctx.route.station);
}
