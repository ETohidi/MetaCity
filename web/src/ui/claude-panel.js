// The "Ask Claude" side of the Ask panel: a short conversation in which Claude answers from
// the twin's own tools. The viewer's API key lives in memory, and in localStorage only if
// they tick "remember"; it is sent to api.anthropic.com and nowhere else.

import { askClaude, MODEL } from "../llm/claude.js";
import { html } from "./dom.js";

const STORE = "metacity.anthropic-key";
let apiKey = null;
try {
  apiKey = localStorage.getItem(STORE);
} catch {
  // storage blocked (private window, preview): the key just isn't remembered
}

function saveKey(key, remember) {
  apiKey = key;
  try {
    if (remember) localStorage.setItem(STORE, key);
    else localStorage.removeItem(STORE);
  } catch {
    // ignore: the key still works for this visit
  }
}

function forgetKey() {
  apiKey = null;
  try {
    localStorage.removeItem(STORE);
  } catch {
    // ignore
  }
}

/** Per-level conversation: API history plus what the viewer sees. */
function convo(ui, level) {
  ui.claude ??= {};
  ui.claude[level] ??= { messages: [], log: [], pending: null, draft: "", error: null };
  return ui.claude[level];
}

const EXAMPLES = {
  country: "Which motorways would suffer most from 20% more traffic, and what would moving trucks to rail do there?",
  city: "If we close Jülicher Straße for roadworks, which streets need attention and how does it look at street level?",
  corridor: "I'm at Hansemannplatz and want to get to Haaren. Should I go now, and is anything blocking the way?",
};

function keyForm() {
  return html`<form class="claude-key" data-claude-key>
    <p class="small">Claude answers in plain language and combines levels, but takes every number from the twin's own answers. Uses your Anthropic API key with ${MODEL}; each question costs a few cents.</p>
    <label class="small" for="claude-key-input">Anthropic API key</label>
    <input id="claude-key-input" class="input" name="key" type="password" autocomplete="off" placeholder="sk-ant-…" required />
    <label class="row small"><input type="checkbox" name="remember" /> Remember on this device</label>
    <p class="small muted">The key goes only to api.anthropic.com, straight from your browser. Anyone with access to this browser could read a remembered key; use a key with a spending limit.</p>
    <button class="btn btn-primary" type="submit">Use this key</button>
  </form>`;
}

export function claudeBody(level, ctx) {
  const c = convo(ctx.ui, level);
  if (!apiKey) return keyForm();
  return html`
    <ol class="claude-log" aria-live="polite">
      ${c.log.map(
        (m) => html`<li class="claude-msg is-${m.role}">
          ${m.role === "assistant" && m.steps?.length ? html`<ul class="claude-steps">${m.steps.map((s) => html`<li class="${s.isError ? "is-error" : ""}">${s.isError ? "Tool error: " : "Asked "}${s.label}</li>`)}</ul>` : ""}
          <p>${m.text}</p>
        </li>`,
      )}
      ${
        c.pending
          ? html`<li class="claude-msg is-assistant is-pending"><ul class="claude-steps">${c.pending.steps.map((s) => html`<li>Asked ${s.label}</li>`)}</ul><p>Thinking…</p></li>`
          : ""
      }
    </ol>
    ${c.error ? html`<p class="ask-miss">${c.error}</p>` : ""}
    <form class="claude-form" data-claude-form>
      <textarea class="input" name="q" rows="3" placeholder="${EXAMPLES[level]}" aria-label="Your question for Claude" data-focus-key="claude-input-${level}"${c.pending ? " disabled" : ""}>${c.draft}</textarea>
      <div class="row between">
        <button class="btn btn-primary" type="submit"${c.pending ? " disabled" : ""}>Ask Claude</button>
        <span class="row">
          ${c.log.length ? html`<button class="btn btn-ghost" type="button" data-claude-new>New conversation</button>` : ""}
          <button class="btn btn-ghost" type="button" data-claude-forget>Forget key</button>
        </span>
      </div>
    </form>`;
}

/** Wire the Claude side of a panel. `rerender` redraws the whole Ask panel. */
export function bindClaude(panel, level, ctx, rerender) {
  const c = convo(ctx.ui, level);
  panel.addEventListener("submit", async (event) => {
    if (event.target.matches("[data-claude-key]")) {
      event.preventDefault();
      const f = new FormData(event.target);
      const key = String(f.get("key") || "").trim();
      if (key) saveKey(key, f.get("remember") === "on");
      rerender();
      return;
    }
    if (!event.target.matches("[data-claude-form]")) return;
    event.preventDefault();
    const question = c.draft.trim();
    if (!question || c.pending) return;
    c.log.push({ role: "user", text: question });
    c.draft = "";
    c.error = null;
    c.pending = { steps: [] };
    rerender();
    try {
      const out = await askClaude({
        twin: ctx.twin,
        level,
        corridor: ctx.corridor,
        apiKey,
        messages: c.messages,
        question,
        onStep: (s) => {
          c.pending.steps.push(s);
          rerender();
        },
      });
      c.log.push({ role: "assistant", text: out.text, steps: out.steps });
    } catch (err) {
      c.error = err.message;
      // Drop the unanswered question from the API history so the next one starts clean.
      if (c.messages.at(-1)?.role === "user" && typeof c.messages.at(-1).content === "string") c.messages.pop();
      if (err.status === 401) forgetKey();
    } finally {
      c.pending = null;
      rerender();
    }
  });
  panel.addEventListener("input", (event) => {
    if (event.target.closest("[data-claude-form]") && event.target.name === "q") c.draft = event.target.value;
  });
  panel.addEventListener("keydown", (event) => {
    // Enter sends, Shift+Enter makes a new line.
    if (event.key === "Enter" && !event.shiftKey && event.target.matches("[data-claude-form] textarea")) {
      event.preventDefault();
      event.target.form.requestSubmit();
    }
  });
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-claude-forget]")) {
      forgetKey();
      rerender();
    }
    if (event.target.closest("[data-claude-new]")) {
      Object.assign(c, { messages: [], log: [], error: null, draft: "" });
      rerender();
    }
  });
}
