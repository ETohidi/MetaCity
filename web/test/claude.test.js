import { test } from "node:test";
import assert from "node:assert/strict";
import { Twin } from "../src/engine/twin.js";
import { askClaude, buildTools, runTool } from "../src/llm/claude.js";

/** A fake Messages API that plays back scripted responses and records requests. */
function fakeApi(responses) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const next = responses.shift();
    return { ok: next.status === undefined, status: next.status ?? 200, statusText: "", json: async () => next.body ?? next };
  };
  return { fetchImpl, requests };
}

test("tools cover every level and validate their schema basics", () => {
  const tools = buildTools(new Twin());
  assert.deepEqual(tools.map((t) => t.name), ["ask_germany", "ask_aachen", "ask_street", "twin_status"]);
  for (const t of tools) assert.equal(t.input_schema.type, "object");
  assert.match(tools[1].description, /jul1 = Jülicher Straße/);
});

test("a tool call is answered from the twin, and bad parameters are rejected", () => {
  const t = new Twin();
  const ok = runTool(t, "ask_aachen", { question: "closure", params: { link: "jul1" } });
  assert.equal(ok.isError, false);
  assert.match(JSON.parse(ok.content).headline, /Closing Jülicher Straße/);
  const bad = runTool(t, "ask_aachen", { question: "closure", params: { link: "nowhere" } });
  assert.equal(bad.isError, true);
  assert.match(bad.content, /Allowed: /);
  assert.equal(runTool(t, "ask_street", { question: "traveltime", corridor: "mars" }).isError, true);
});

test("the loop runs tools, sends results back in one message and returns Claude's text", async () => {
  const t = new Twin();
  const { fetchImpl, requests } = fakeApi([
    {
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [
        { type: "text", text: "Let me check both levels." },
        { type: "tool_use", id: "tu1", name: "ask_aachen", input: { question: "closure", params: { link: "jul1" } } },
        { type: "tool_use", id: "tu2", name: "ask_street", input: { question: "traveltime", corridor: "julicher", params: { from: 0, to: 5 } } },
      ],
    },
    { stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 8 }, content: [{ type: "text", text: "Closing it costs time." }] },
  ]);
  const messages = [];
  const out = await askClaude({ twin: t, level: "corridor", corridor: "julicher", apiKey: "sk-test", messages, question: "Will a closure hurt me?", fetchImpl });
  assert.equal(out.text, "Closing it costs time.");
  assert.equal(out.steps.length, 2);
  assert.equal(requests.length, 2);
  const second = requests[1].body.messages;
  assert.equal(second.at(-1).role, "user");
  assert.deepEqual(second.at(-1).content.map((b) => b.tool_use_id), ["tu1", "tu2"]);
  assert.equal(requests[0].body.model, "claude-opus-5-5");
  assert.equal(requests[0].body.fallbacks, "default");
  assert.equal(requests[0].headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.ok(!JSON.stringify(requests[0].body).includes("sk-test"), "the key must only travel in the header");
  assert.equal(out.usage.input, 30);
});

test("a refusal stops without running tools", async () => {
  const t = new Twin();
  const { fetchImpl } = fakeApi([{ stop_reason: "refusal", content: [{ type: "tool_use", id: "x", name: "ask_aachen", input: { question: "daily" } }] }]);
  const out = await askClaude({ twin: t, level: "city", apiKey: "k", messages: [], question: "?", fetchImpl });
  assert.equal(out.stopReason, "refusal");
  assert.equal(out.steps.length, 0);
});

test("API errors become readable messages", async () => {
  const t = new Twin();
  const { fetchImpl } = fakeApi([{ status: 401, body: { error: { message: "invalid x-api-key" } } }]);
  await assert.rejects(askClaude({ twin: t, level: "city", apiKey: "bad", messages: [], question: "?", fetchImpl }), /key was not accepted/);
});
