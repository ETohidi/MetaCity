// Small shared helpers for building HTML strings safely, plus formatters and the
// visual vocabulary (chips, load meters, fidelity cards) every view uses.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

class Raw {
  constructor(s) {
    this.s = String(s);
  }
  toString() {
    return this.s;
  }
}

/** Mark a string as already-safe HTML so html`` doesn't escape it. */
export function raw(s) {
  return new Raw(s);
}

function interpolate(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(interpolate).join("");
  if (v === null || v === undefined || v === false) return "";
  return esc(v);
}

/** Tagged template: escapes every interpolated value unless it came from raw() or html``. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += interpolate(values[i]) + strings[i + 1];
  return raw(out);
}

// -- formatters ---------------------------------------------------------------
export const int = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");
export const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");
export const kmh = (x) => (Number.isFinite(x) ? `${Math.round(x)} km/h` : "—");

/** Load band used everywhere: free below 70% of capacity, busy to 95%, congested above. */
export function loadTone(vc) {
  if (vc > 0.95) return "crit";
  if (vc > 0.7) return "warn";
  return "ok";
}
export const LOAD_LABEL = { ok: "Free flow", warn: "Busy", crit: "Congested" };
export const loadColor = (vc) => `var(--${loadTone(vc)})`;

// -- visual vocabulary ----------------------------------------------------------
export function chip(text, tone = "", { plain = false, title = "" } = {}) {
  const cls = ["chip", tone && `chip-${tone}`, plain && "chip-plain"].filter(Boolean).join(" ");
  return html`<span class="${cls}"${title ? raw(` title="${esc(title)}"`) : ""}>${text}</span>`;
}

export function meter(fraction, label = "Load") {
  const tone = loadTone(fraction);
  const width = Math.max(0, Math.min(1, fraction)) * 100;
  const value = Math.round(fraction * 100);
  return html`<div class="meter is-${tone}" role="meter" aria-valuemin="0" aria-valuemax="${Math.max(100, value)}" aria-valuenow="${value}" aria-valuetext="${value}% of capacity" aria-label="${label}"><span style="width:${width.toFixed(1)}%"></span></div>`;
}

/**
 * What a level knows and how precisely: the heart of the hierarchy. `feeds` names the
 * hand-overs to the levels above and below.
 */
export function fidelityCard({ level, title, data, resolution, update, feeds }) {
  return html`<section class="card fidelity" aria-label="What this level knows">
    <div class="fidelity-head"><span class="fidelity-level">L${level}</span><h3>${title}</h3></div>
    <dl class="kv kv-left">
      <dt>Data</dt><dd>${data}</dd>
      <dt>Resolution</dt><dd>${resolution}</dd>
      <dt>Updates</dt><dd>${update}</dd>
    </dl>
    ${feeds?.length ? html`<ul class="feeds">${feeds.map((f) => html`<li><span class="feed-arrow">${f.dir === "up" ? "↑" : "↓"}</span>${f.text}</li>`)}</ul>` : ""}
  </section>`;
}

/** A tiny bar chart for 24 hourly values, with the current hour marked. */
export function hourBars(values, { mark = -1, label = "", height = 56, onClickAttr = "" } = {}) {
  const max = Math.max(...values, 1e-9);
  const w = 100 / values.length;
  return html`<svg class="hour-bars" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img" aria-label="${label}">
    ${values.map((v, h) => {
      const bh = Math.max(0.5, (v / max) * (height - 2));
      return html`<rect x="${(h * w + 0.4).toFixed(2)}" y="${(height - bh).toFixed(2)}" width="${(w - 0.8).toFixed(2)}" height="${bh.toFixed(2)}" class="${h === mark ? "is-mark" : ""}"${onClickAttr ? raw(` ${onClickAttr}="${h}"`) : ""}><title>${String(h).padStart(2, "0")}:00 · ${int(v)}</title></rect>`;
    })}
  </svg>
  <div class="hour-axis" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>`;
}
