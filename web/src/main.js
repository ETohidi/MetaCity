// Boot, routing, the top bar (zoom ladder + shared clock) and the render loop.
// Each view exports mount(view, ctx) (on route change), update(view, ctx) (about once a
// second) and optionally frame(view, ctx) (every animation frame, for canvases).

import { CORRIDOR_BY_ID } from "./data/aachen.js";
import { Twin } from "./engine/twin.js";
import * as cityView from "./ui/city.js";
import * as corridorView from "./ui/corridor.js";
import * as countryView from "./ui/country.js";
import { chip, html, raw } from "./ui/dom.js";

const SPEEDS = [1, 10, 60, 300];
const UPDATE_MS = 1000;

const twin = new Twin();
/** Per-viewer UI state that survives re-renders. */
const ui = { playing: true, speed: 10, sel: { segment: null, link: null, station: null }, ask: {} };

const $ = (sel) => document.querySelector(sel);
const view = $("#view");
const ladder = $("#ladder");
const simbar = $("#simbar");
const statusline = $("#statusline");
const toasts = $("#toasts");

// -- routes -------------------------------------------------------------------
// Plain hash tokens only (the artifact viewer drops anything else):
// "germany", "aachen", "<corridor>" and "<corridor>.j<station>".
function parseRoute(hash) {
  let token = hash.replace(/^#/, "");
  try {
    token = decodeURIComponent(token).toLowerCase();
  } catch {
    token = "";
  }
  if (token === "aachen") return { level: 2, token };
  const [cid, j] = token.split(".");
  if (CORRIDOR_BY_ID[cid]) {
    const sim = twin.corridors[cid];
    const k = j && /^j\d+$/.test(j) ? Number(j.slice(1)) : null;
    if (k !== null && sim.def.stations[k]?.signal) return { level: 4, token, corridor: cid, station: k };
    return { level: 3, token: cid, corridor: cid };
  }
  return { level: 1, token: "germany" };
}

let route = parseRoute(location.hash);
window.addEventListener("hashchange", () => {
  route = parseRoute(location.hash);
  mountView();
});

// -- toasts ---------------------------------------------------------------------
function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  toasts.append(el);
  setTimeout(() => el.remove(), 4200);
}

// -- top bar ------------------------------------------------------------------------
const ICONS = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>',
  restart:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5v3h3"/></svg>',
};

function ladderSteps() {
  const sim = route.corridor ? twin.corridors[route.corridor] : null;
  const st = sim && route.station !== undefined ? sim.def.stations[route.station] : null;
  return [
    { level: 1, name: "Germany", scale: "statistics · yearly", token: "germany" },
    { level: 2, name: "Aachen", scale: "model · hourly", token: "aachen" },
    sim ? { level: 3, name: sim.def.name, scale: "vehicles · 0.5 s", token: sim.def.id } : { level: 3, name: "Corridor", scale: "pick on the map", pending: true },
    st
      ? { level: 4, name: st.name.replace(/^Junction /, ""), scale: "sensors · live", token: route.token }
      : { level: 4, name: "Junction", scale: sim ? "pick a junction" : "—", pending: true },
  ];
}

function renderLadder() {
  ladder.innerHTML = String(
    html`${ladderSteps().map((s) => {
      const inner = html`<span class="step-name">${s.name}</span><span class="step-scale">${s.scale}</span>`;
      if (s.pending) return html`<li><span class="step is-pending">${inner}</span></li>`;
      return html`<li><a href="#${s.token}"${s.level === route.level ? raw(' aria-current="page"') : ""}>${inner}</a></li>`;
    })}`,
  );
}

let clockEl = null;
let simbarKey = null;
function renderSimbar() {
  if (!clockEl) {
    simbar.innerHTML = String(html`
      <div class="clock"><span class="clock-time" aria-label="Simulation time"></span><span class="clock-day">Weekday · shared by all levels</span></div>
      <div class="simbar-buttons"></div>`);
    clockEl = simbar.querySelector(".clock-time");
  }
  if (clockEl.textContent !== twin.clock) clockEl.textContent = twin.clock;
  const key = `${ui.playing}|${ui.speed}|${twin.hour}`;
  if (key === simbarKey || simbar.querySelector("select") === document.activeElement) return;
  simbarKey = key;
  simbar.querySelector(".simbar-buttons").innerHTML = String(html`
    <button class="btn btn-primary" data-sim="play" aria-pressed="${ui.playing}">${raw(ui.playing ? ICONS.pause : ICONS.play)} ${ui.playing ? "Pause" : "Play"}</button>
    <button class="btn btn-ghost" data-sim="speed" title="Simulation speed">${ui.speed}×</button>
    <label class="jump"><span class="sr-only">Jump to hour</span>
      <select class="select select-inline" data-sim="jump" aria-label="Jump to hour">
        ${Array.from({ length: 24 }, (_, h) => html`<option value="${h}"${h === twin.hour ? raw(" selected") : ""}>${String(h).padStart(2, "0")}:00</option>`)}
      </select>
    </label>
    <button class="btn btn-ghost" data-sim="reset" title="Back to 07:30, today's network, no incidents">${raw(ICONS.restart)} <span class="btn-label">Restart</span></button>`);
}

function renderStatus() {
  const s = twin.scenario;
  const changes = [
    s.closed.length && `${s.closed.length} closed`,
    s.busLanes.length && `${s.busLanes.length} bus lane${s.busLanes.length > 1 ? "s" : ""}`,
    s.zone30 && "30 km/h zone",
    s.demand !== 1 && `demand ${Math.round(s.demand * 100)}%`,
  ].filter(Boolean);
  const incidents = Object.values(twin.corridors).reduce((n, c) => n + c.incidents.length, 0);
  const degraded = Object.values(twin.corridors).reduce((n, c) => n + c.health.filter((h) => h !== "ok").length, 0);
  statusline.innerHTML = String(html`
    ${chip("Simulated data", "", { plain: true })}
    ${chip("Rule-based answers, no LLM", "", { plain: true })}
    ${changes.length ? html`<a class="chip chip-accent" href="#aachen">Scenario: ${changes.join(", ")}</a>` : chip("Today's network")}
    ${incidents ? chip(`${incidents} lane${incidents > 1 ? "s" : ""} blocked`, "crit") : ""}
    ${degraded ? chip(`${degraded} sensor mast${degraded > 1 ? "s" : ""} degraded`, "warn") : ""}
  `);
}

function renderTop() {
  renderLadder();
  renderSimbar();
  renderStatus();
}

simbar.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-sim]");
  if (!btn) return;
  if (btn.dataset.sim === "play") ui.playing = !ui.playing;
  if (btn.dataset.sim === "speed") ui.speed = SPEEDS[(SPEEDS.indexOf(ui.speed) + 1) % SPEEDS.length];
  if (btn.dataset.sim === "reset") {
    twin.reset();
    ui.ask = {};
    toast("Restarted at 07:30 with today's network.");
    mountView();
    return;
  }
  renderTop();
});
simbar.addEventListener("change", (event) => {
  if (!event.target.matches("[data-sim=jump]")) return;
  twin.setTime(Number(event.target.value) * 3600 + 30 * 60);
  toast(`Jumped to ${twin.clock}. The street simulations restart with a short warm-up.`);
  refresh();
});

// -- views ---------------------------------------------------------------------------
const VIEWS = { 1: countryView, 2: cityView, 3: corridorView, 4: corridorView };
let pointerDown = false;
document.addEventListener("pointerdown", () => (pointerDown = true), true);
document.addEventListener("pointerup", () => (pointerDown = false), true);
document.addEventListener("pointercancel", () => (pointerDown = false), true);

/** True while the viewer types or chooses in the view, or is mid-click. */
function isBusy() {
  const a = document.activeElement;
  return pointerDown || Boolean(a && view.contains(a) && a.matches("input, select, textarea"));
}

const ctx = () => ({ twin, ui, route, toast, onTwinChange: refresh });

function mountView() {
  const mod = VIEWS[route.level];
  renderTop();
  view.innerHTML = "";
  mod.mount(view, ctx());
  view.classList.remove("view-enter");
  void view.offsetWidth;
  view.classList.add("view-enter");
  window.scrollTo({ top: 0 });
  const h1 = view.querySelector("h1")?.textContent.trim();
  document.title = h1 ? `${h1} · MetaCity` : "MetaCity";
  view.focus({ preventScroll: true });
  lastUpdate = performance.now();
}

function refresh() {
  renderTop();
  if (!isBusy()) VIEWS[route.level].update(view, ctx());
}

// -- loop -------------------------------------------------------------------------------
let last = performance.now();
let lastUpdate = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (ui.playing && !document.hidden) twin.tick(dt * ui.speed);
  renderSimbar();
  const mod = VIEWS[route.level];
  if (mod.frame) mod.frame(view, ctx());
  if (now - lastUpdate > UPDATE_MS) {
    lastUpdate = now;
    refresh();
  }
  requestAnimationFrame(loop);
}

mountView();
requestAnimationFrame(loop);

// Exposed for debugging in the browser console.
window.metacity = { twin, ui };
