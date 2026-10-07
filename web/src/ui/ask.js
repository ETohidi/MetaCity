// The "Ask the twin" panel, shared by every level. Suggested questions open as a sentence
// with inline choices; typed questions are matched to the same catalogue (rule-based, no LLM).
// Answers are frozen at the time they were asked and say which level and data they come from.

import { QUESTIONS, ROLES } from "../engine/ask.js";
import { esc, hourBars, html, raw } from "./dom.js";

const PLACEHOLDER = {
  country: "e.g. What if truck traffic on the A2 moves to rail?",
  city: "e.g. What if we close Jülicher Straße?",
  corridor: "e.g. How long to Haaren? When is the light green?",
};

/** Per-level panel state lives in ui.ask[level]: { qid, params, answer, typed, miss }. */
function state(ui, level) {
  ui.ask ??= {};
  ui.ask[level] ??= { qid: null, params: {}, answer: null, typed: "", miss: false };
  return ui.ask[level];
}

function questionForm(twin, level, st, ctx) {
  const q = QUESTIONS[level].find((x) => x.id === st.qid);
  if (!q?.params?.length) return "";
  // The sentence with a <select> where each {param} sits.
  const parts = q.text.split(/(\{\w+\})/);
  return html`<form class="ask-form" data-ask-form>
    <p>${parts.map((part) => {
      const m = part.match(/^\{(\w+)\}$/);
      if (!m) return part;
      const p = q.params.find((x) => x.key === m[1]);
      const opts = p.options(twin, ctx);
      return html`<select class="select select-inline" data-ask-param="${p.key}" aria-label="${p.label}">
        ${opts.map((o) => html`<option value="${o.value}"${String(o.value) === String(st.params[p.key]) ? raw(" selected") : ""}>${o.label}</option>`)}
      </select>`;
    })}</p>
  </form>`;
}

function answerBlock(a) {
  if (!a) return "";
  return html`<article class="answer" aria-live="polite">
    <p class="answer-q">${a.question}</p>
    <p class="answer-headline">${a.headline}</p>
    ${a.body.filter(Boolean).map((b) => html`<p class="answer-body">${b}</p>`)}
    ${a.facts?.length ? html`<dl class="kv answer-facts">${a.facts.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : ""}
    ${a.series ? html`<div class="answer-series"><div class="eyebrow">${a.series.label}</div>${hourBars(a.series.values, { mark: a.series.mark, label: a.series.label })}</div>` : ""}
    ${
      a.table?.rows?.length
        ? html`<div class="table-wrap"><table class="table answer-table">
            <thead><tr>${a.table.head.map((h, i) => html`<th${i ? raw(' class="num"') : ""}>${h}</th>`)}</tr></thead>
            <tbody>${a.table.rows.map((r) => html`<tr>${r.map((c, i) => html`<td${i ? raw(' class="num"') : ""}>${c}</td>`)}</tr>`)}</tbody>
          </table></div>`
        : ""
    }
    <footer class="answer-basis">
      <span class="chip chip-accent">${a.basis.level} level</span>
      <span>${a.basis.data}.</span>
      <span>Resolution: ${a.basis.resolution}. Confidence: ${a.basis.confidence}.</span>
      <span class="mono">Answered at ${a.time}</span>
    </footer>
  </article>`;
}

/** The panel's HTML. ctx needs { twin, ui }; corridor questions also need ctx.corridor. */
export function askPanel(level, ctx) {
  const { twin, ui } = ctx;
  const st = state(ui, level);
  return html`<section class="card ask" data-ask="${level}" aria-labelledby="ask-title-${level}">
    <div class="ask-head">
      <h3 id="ask-title-${level}">Ask the twin</h3>
      <span class="chip chip-plain">as ${ROLES[level]}</span>
    </div>
    <form class="ask-free" data-ask-free>
      <input class="input" name="q" autocomplete="off" placeholder="${PLACEHOLDER[level]}" value="${st.typed}" aria-label="Your question" data-focus-key="ask-input-${level}" />
      <button class="btn btn-primary" type="submit">Ask</button>
    </form>
    ${st.miss ? html`<p class="ask-miss">I can't answer that one yet. These are the questions this level knows:</p>` : ""}
    <ul class="ask-suggest" aria-label="Questions this level can answer">
      ${QUESTIONS[level].map(
        (q) => html`<li><button type="button" class="ask-chip${q.id === st.qid ? " is-active" : ""}" data-ask-q="${q.id}" aria-pressed="${q.id === st.qid}" data-focus-key="ask-q-${level}-${q.id}">${q.text.replace(/\{\w+\}/g, "…")}</button></li>`,
      )}
    </ul>
    ${questionForm(twin, level, st, { corridor: ctx.corridor })}
    ${answerBlock(st.answer)}
    ${st.answer ? html`<div class="row ask-actions">${st.answer.apply ? html`<button type="button" class="btn btn-primary" data-ask-apply>Apply to the twin</button>` : ""}<button type="button" class="btn btn-ghost" data-ask-refresh>Ask again now</button><button type="button" class="btn btn-ghost" data-ask-clear>Clear</button></div>` : ""}
  </section>`;
}

function run(level, ctx, st) {
  st.answer = ctx.twin.ask(level, st.qid, { ...st.params, corridor: ctx.corridor });
  st.params = { ...st.answer.params };
  delete st.params.corridor;
}

/**
 * Wire the panel inside `root`. `onChange` re-renders the panel (and lets the view redraw
 * any highlight the answer carries).
 */
export function bindAsk(root, level, ctx, onChange) {
  const panel = root.querySelector(`[data-ask="${level}"]`);
  if (!panel) return;
  const st = state(ctx.ui, level);
  panel.addEventListener("click", (event) => {
    const qBtn = event.target.closest("[data-ask-q]");
    if (qBtn) {
      const qid = qBtn.dataset.askQ;
      if (st.qid !== qid) st.params = {};
      st.qid = qid;
      st.miss = false;
      run(level, ctx, st);
      onChange();
      return;
    }
    if (event.target.closest("[data-ask-apply]") && st.answer?.apply) {
      ctx.twin.setScenario(st.answer.apply);
      ctx.toast?.("Scenario applied: every level now runs with it, down to the street simulations.");
      ctx.onTwinChange?.();
      onChange();
      return;
    }
    if (event.target.closest("[data-ask-refresh]") && st.qid) {
      run(level, ctx, st);
      onChange();
    }
    if (event.target.closest("[data-ask-clear]")) {
      Object.assign(st, { qid: null, params: {}, answer: null, typed: "", miss: false });
      onChange();
    }
  });
  panel.addEventListener("change", (event) => {
    const sel = event.target.closest("[data-ask-param]");
    if (!sel) return;
    const raw = sel.value;
    st.params[sel.dataset.askParam] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    run(level, ctx, st);
    onChange();
  });
  panel.addEventListener("input", (event) => {
    if (event.target.name === "q") st.typed = event.target.value;
  });
  panel.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.target.matches("[data-ask-free]")) return;
    const text = st.typed.trim();
    if (!text) return;
    const hit = ctx.twin.match(level, text, { corridor: ctx.corridor });
    if (!hit) {
      st.miss = true;
      st.answer = null;
      st.qid = null;
    } else {
      st.miss = false;
      st.qid = hit.qid;
      st.params = hit.params;
      run(level, ctx, st);
    }
    onChange();
  });
}

/** The highlight of the current answer at a level, if any. */
export const askHighlight = (ui, level) => ui.ask?.[level]?.answer?.highlight ?? {};

export { esc };
