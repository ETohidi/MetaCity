// Optional LLM layer: Claude answers in plain language, but every fact comes from the twin.
// Claude gets the rule-based question catalogue of each level as tools (plus a status tool),
// so it can combine levels ("will closing Jülicher Straße change my drive?") without
// inventing numbers. It can only ask, never change the twin: applying a scenario stays a
// human button. No DOM here; the network call is injected so tests can run without a key.
//
// The site has no backend, so the viewer brings their own Anthropic API key and the browser
// calls the Messages API directly (raw HTTP: the project has no bundler or npm runtime deps).

import { QUESTIONS, ROLES, questionText } from "../engine/ask.js";

export const MODEL = "claude-opus-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_ROUNDS = 8; // model calls per question, to bound cost

const LEVEL_TOOL = { country: "ask_germany", city: "ask_aachen", corridor: "ask_street" };
const LEVEL_NAME = { country: "Germany", city: "Aachen", corridor: "Street corridor" };
const TOOL_LEVEL = Object.fromEntries(Object.entries(LEVEL_TOOL).map(([l, t]) => [t, l]));

/** Describe a question and its allowed parameter values, for the tool description. */
function describeQuestion(twin, level, q, corridor) {
  const params = (q.params ?? []).map((p) => {
    const opts = p.options(twin, { corridor });
    return `    ${p.key}: ${opts.map((o) => (String(o.value) === String(o.label) ? o.value : `${o.value} = ${o.label}`)).join("; ")}`;
  });
  return [`  - ${q.id}: ${q.text}`, ...params].join("\n");
}

/** The tools Claude may call: one per level, plus the twin's status. */
export function buildTools(twin) {
  const corridors = Object.keys(twin.corridors);
  const tools = Object.keys(QUESTIONS).map((level) => {
    const perCorridor = level === "corridor";
    const catalogue = perCorridor
      ? corridors
          .map((c) => `Corridor "${c}" (${twin.corridors[c].def.name}):\n${QUESTIONS[level].map((q) => describeQuestion(twin, level, q, c)).join("\n")}`)
          .join("\n")
      : QUESTIONS[level].map((q) => describeQuestion(twin, level, q)).join("\n");
    return {
      name: LEVEL_TOOL[level],
      description:
        `Ask the ${LEVEL_NAME[level]} level of the twin (it answers as it would a ${ROLES[level].toLowerCase()}). ` +
        `Returns a headline, details, figures and the data basis. Questions and their parameter values:\n${catalogue}\n` +
        `Parameters you leave out take sensible defaults (for example the current hour).`,
      input_schema: {
        type: "object",
        properties: {
          question: { type: "string", enum: QUESTIONS[level].map((q) => q.id), description: "Question id from the list." },
          params: { type: "object", description: "Parameter values for the question, using the values listed (numbers as numbers)." },
          ...(perCorridor ? { corridor: { type: "string", enum: corridors, description: "Which street corridor." } } : {}),
        },
        required: perCorridor ? ["question", "corridor"] : ["question"],
      },
    };
  });
  tools.push({
    name: "twin_status",
    description:
      "Current time of day in the simulation, the active planning scenario (closures, bus lanes, 30 km/h zone, demand), and the alerts the twin has raised on each corridor. Call this when the answer depends on what is happening now.",
    input_schema: { type: "object", properties: {} },
  });
  return tools;
}

/** Run one tool call against the twin. Returns { content, isError, label }. */
export function runTool(twin, name, input = {}) {
  if (name === "twin_status") {
    const status = {
      time: twin.clock,
      scenario: twin.scenario,
      alerts: Object.fromEntries(
        Object.keys(twin.corridors).map((c) => [
          c,
          twin.alerts(c).map((a) => ({ kind: a.kind, near: twin.corridors[c].def.stations[a.station].name, confidence: Math.round(a.confidence * 100) / 100, state: a.state })),
        ]),
      ),
    };
    return { content: JSON.stringify(status), isError: false, label: "the twin's status (time, scenario, alerts)" };
  }
  const level = TOOL_LEVEL[name];
  if (!level) return { content: `Unknown tool ${name}.`, isError: true, label: name };
  const q = QUESTIONS[level].find((x) => x.id === input.question);
  if (!q) return { content: `Unknown question "${input.question}". Use one of: ${QUESTIONS[level].map((x) => x.id).join(", ")}.`, isError: true, label: name };
  const corridor = level === "corridor" ? input.corridor : undefined;
  if (level === "corridor" && !twin.corridors[corridor]) {
    return { content: `Unknown corridor "${corridor}". Use one of: ${Object.keys(twin.corridors).join(", ")}.`, isError: true, label: name };
  }
  // Only accept parameter values the catalogue offers.
  const params = {};
  for (const [key, value] of Object.entries(input.params ?? {})) {
    const p = q.params?.find((x) => x.key === key);
    if (!p) return { content: `Question "${q.id}" has no parameter "${key}".`, isError: true, label: name };
    const opt = p.options(twin, { corridor }).find((o) => String(o.value) === String(value));
    if (!opt) {
      const allowed = p.options(twin, { corridor }).map((o) => o.value).join(", ");
      return { content: `"${value}" is not a valid ${key}. Allowed: ${allowed}.`, isError: true, label: name };
    }
    params[key] = opt.value;
  }
  const a = twin.ask(level, q.id, { ...params, corridor });
  const result = {
    level: a.basis.level,
    question: a.question,
    headline: a.headline,
    details: a.body,
    facts: a.facts,
    table: a.table ? { head: a.table.head, rows: a.table.rows.slice(0, 8) } : undefined,
    basis: a.basis,
    answeredAt: a.time,
  };
  return { content: JSON.stringify(result), isError: false, label: `${LEVEL_NAME[level]}: ${questionText(twin, level, q.id, a.params, { corridor })}` };
}

/** System prompt per level: stable text (no clock), so it caches. */
export function systemPrompt(level, corridorName) {
  return [
    "You answer questions about MetaCity, a hierarchical traffic digital twin with three levels:",
    "Germany (annual motorway statistics, rough), Aachen (an hourly city model, moderate precision) and street corridors",
    "(vehicle-by-vehicle simulation observed by sensor masts, precise). All data in it is simulated or illustrative.",
    "",
    `The person asking is a ${ROLES[level].toLowerCase()}${corridorName ? ` looking at ${corridorName}` : ""}.`,
    "Get every number and claim from the tools; call several levels when the question spans them.",
    "If no tool can answer it, say so plainly instead of guessing. Say which level an answer comes from and how precise that level is.",
    "Answer in a few short sentences or a short list, in the language the person uses. You cannot change the twin; if they want to",
    "apply a scenario, tell them to use the Apply button in the Aachen level's answers.",
  ].join("\n");
}

export class ClaudeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** POST /v1/messages from the browser with the viewer's key. */
export async function callMessages({ apiKey, body, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ClaudeError("Could not reach the Anthropic API. Check your connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? res.statusText;
    if (res.status === 401) throw new ClaudeError("The API key was not accepted.", 401);
    if (res.status === 429) throw new ClaudeError("Rate limited by the API. Wait a moment and try again.", 429);
    if (res.status === 529 || res.status >= 500) throw new ClaudeError("The API is busy right now. Try again shortly.", res.status);
    throw new ClaudeError(`API error ${res.status}: ${msg}`, res.status);
  }
  return data;
}

/**
 * Ask Claude one question in an ongoing conversation. `messages` is the API history and is
 * extended in place (full assistant content, including thinking blocks, is kept as returned).
 * Returns { text, steps: [{label, isError}], stopReason, usage }.
 */
export async function askClaude({ twin, level, corridor, apiKey, messages, question, fetchImpl = fetch, onStep = () => {} }) {
  const tools = buildTools(twin);
  const system = systemPrompt(level, corridor ? twin.corridors[corridor].def.name : null);
  messages.push({ role: "user", content: question });
  const steps = [];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await callMessages({
      apiKey,
      fetchImpl,
      body: {
        model: MODEL,
        max_tokens: 16000,
        system,
        tools,
        messages,
        output_config: { effort: "low" },
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
      },
    });
    usage.input += res.usage?.input_tokens ?? 0;
    usage.output += res.usage?.output_tokens ?? 0;
    usage.cacheRead += res.usage?.cache_read_input_tokens ?? 0;
    if (res.stop_reason === "refusal") {
      // Never run tools from a refused turn; keep history consistent by not appending it.
      return { text: "Claude declined to answer this one.", steps, stopReason: "refusal", usage };
    }
    messages.push({ role: "assistant", content: res.content });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const calls = res.content.filter((b) => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      const cut = res.stop_reason === "max_tokens" ? " (answer cut short)" : "";
      return { text: (text || "No answer.") + cut, steps, stopReason: res.stop_reason, usage };
    }
    // Run every call of this turn and send all results back in one message.
    const results = calls.map((call) => {
      const r = runTool(twin, call.name, call.input);
      const step = { label: r.label, isError: r.isError };
      steps.push(step);
      onStep(step);
      return { type: "tool_result", tool_use_id: call.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
    });
    messages.push({ role: "user", content: results });
  }
  return { text: "Stopped after too many steps. Try a narrower question.", steps, stopReason: "max_rounds", usage };
}
