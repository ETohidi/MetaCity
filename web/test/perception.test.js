import { test } from "node:test";
import assert from "node:assert/strict";
import { Twin } from "../src/engine/twin.js";

const europaplatz = (t) => t.corridors.julicher.def.stations.findIndex((s) => s.name === "Europaplatz");

test("a blockage in front of a healthy mast is raised within half a minute", () => {
  const t = new Twin({ start: 11 * 3600 });
  const j = europaplatz(t);
  const x = t.corridors.julicher.def.stations[j].x - 45;
  t.addIncident("julicher", { d: 0, lane: 0, x, minutes: 20 });
  t.tick(30);
  const alert = t.alerts("julicher").find((a) => a.kind === "stalled");
  assert.ok(alert, "no alert raised");
  assert.ok(alert.sources.mast, "the mast camera should be a source");
  assert.ok(alert.raisedAt - t.corridors.julicher.incidents[0].since <= 30);
});

test("a tampered mast reports itself and mostly misses what happens in front of it", () => {
  const t = new Twin({ start: 11 * 3600 });
  const j = europaplatz(t);
  t.setMastHealth("julicher", j, "degraded");
  t.addIncident("julicher", { d: 0, lane: 0, x: t.corridors.julicher.def.stations[j].x - 45, minutes: 20 });
  t.tick(20);
  const alerts = t.alerts("julicher");
  assert.ok(alerts.some((a) => a.kind === "obstructed" && a.station === j));
  const stalled = alerts.find((a) => a.kind === "stalled");
  assert.ok(!stalled || !stalled.sources.mast || stalled.sources.mast < 0.8, "a degraded camera should not be confident");
});

test("alerts clear after the blockage is gone, and the operator can dismiss one", () => {
  const t = new Twin({ start: 11 * 3600 });
  const j = europaplatz(t);
  t.addIncident("julicher", { d: 1, lane: 0, x: t.corridors.julicher.def.stations[j].x + 45, minutes: 1 });
  t.tick(40);
  const a = t.alerts("julicher").find((x) => x.kind === "stalled");
  assert.ok(a);
  t.reviewAlert("julicher", a.id, "dismissed");
  assert.ok(!t.alerts("julicher").some((x) => x.id === a.id));
  t.tick(120);
  assert.equal(t.alerts("julicher").filter((x) => x.kind === "stalled").length, 0);
});

test("the driver's answer only knows what the twin perceives", () => {
  const t = new Twin({ start: 11 * 3600 });
  // Between masts, before any connected vehicle has stopped behind it: unknown.
  t.addIncident("julicher", { d: 0, lane: 0, x: 1250, minutes: 20 });
  t.tick(1);
  const before = t.ask("corridor", "ahead", { corridor: "julicher" });
  assert.doesNotMatch(before.headline, /^Yes/);
  assert.ok(before.body.some((b) => /1 actual blockage, 0 known/.test(b)));
});
