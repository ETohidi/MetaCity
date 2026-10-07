import { test } from "node:test";
import assert from "node:assert/strict";
import { Twin } from "../src/engine/twin.js";
import { QUESTIONS } from "../src/engine/ask.js";

test("the same seed replays the same street", () => {
  const a = new Twin({ seed: 5 });
  const b = new Twin({ seed: 5 });
  a.tick(600);
  b.tick(600);
  const pos = (t) =>
    t.corridors.julicher
      .vehicles()
      .map((v) => `${v.id}:${v.s.toFixed(2)}`)
      .join(",");
  assert.equal(pos(a), pos(b));
  assert.ok(a.corridors.julicher.vehicles().length > 20);
});

test("asking questions does not change the simulation", () => {
  const a = new Twin({ seed: 9 });
  const b = new Twin({ seed: 9 });
  a.tick(120);
  b.tick(120);
  for (const level of Object.keys(QUESTIONS)) {
    for (const q of QUESTIONS[level]) a.ask(level, q.id, { corridor: "julicher" });
  }
  a.tick(300);
  b.tick(300);
  const ids = (t) =>
    t.corridors.julicher
      .vehicles()
      .map((v) => v.id)
      .join(",");
  assert.equal(ids(a), ids(b));
});

test("every question answers on every corridor", () => {
  const t = new Twin();
  t.tick(600);
  for (const level of Object.keys(QUESTIONS)) {
    for (const q of QUESTIONS[level]) {
      for (const corridor of Object.keys(t.corridors)) {
        const a = t.ask(level, q.id, { corridor });
        assert.ok(a.headline && !/NaN|undefined|Infinity/.test(a.headline), `${level}/${q.id}: ${a.headline}`);
        for (const line of a.body) assert.ok(!/NaN|undefined|Infinity/.test(line ?? ""), `${level}/${q.id}: ${line}`);
        for (const row of a.table?.rows ?? []) assert.ok(!/NaN|undefined/.test(row.join(" ")), `${level}/${q.id}: ${row}`);
      }
    }
  }
});

test("street sensors roughly agree with the city model off-peak", () => {
  const t = new Twin({ start: 11 * 3600 });
  t.tick(900);
  const rows = t.calibration().filter((r) => r.model > 200 && r.link !== "jul1");
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(r.ratio > 0.5 && r.ratio < 1.6, `${r.name} ${r.from}->${r.to}: model ${r.model.toFixed(0)} sensed ${r.sensed.toFixed(0)}`);
  }
});

test("country volumes reach the city gateways", () => {
  const t = new Twin();
  const a = t.ask("country", "aachen");
  for (const [, aadt, city] of a.table.rows) {
    const ratio = Number(city.replace(/,/g, "")) / Number(aadt.replace(/,/g, ""));
    assert.ok(ratio > 0.7 && ratio < 1.3, `country ${aadt} vs city ${city}`);
  }
});

test("closing a road moves traffic elsewhere", () => {
  const t = new Twin();
  const a = t.ask("city", "closure", { link: "jul1" });
  assert.match(a.headline, /loses/);
  assert.ok(a.table.rows.length > 0);
});

test("a blocked lane slows the corridor and is reported to drivers", () => {
  const t = new Twin({ start: 11 * 3600 });
  t.addIncident("julicher", { d: 0, lane: 0, x: 1500, minutes: 30 });
  t.tick(300);
  const a = t.ask("corridor", "ahead", { corridor: "julicher" });
  assert.match(a.headline, /blocked/);
});

test("free text finds the right question and its parameters", () => {
  const t = new Twin();
  const ctx = { corridor: "julicher" };
  assert.equal(t.match("city", "what happens if we close Roermonder Straße?").qid, "closure");
  assert.equal(t.match("city", "what happens if we close Pauwelsstraße?").params.link, "pau");
  const rail = t.match("country", "what if 30% of trucks on the A2 go by rail");
  assert.equal(rail.qid, "rail");
  assert.equal(rail.params.road, "A2");
  assert.equal(rail.params.share, 30);
  const tt = t.match("corridor", "how long from Europaplatz to Haaren?", ctx);
  assert.equal(tt.qid, "traveltime");
  const st = t.corridors.julicher.def.stations;
  assert.equal(st[tt.params.from].name, "Europaplatz");
  assert.equal(st[tt.params.to].name, "Haaren");
  const goal = t.match("corridor", "how long to Hansemannplatz", ctx);
  assert.equal(st[goal.params.to].name, "Hansemannplatz");
  assert.equal(t.match("corridor", "when does the light turn green at Europaplatz", ctx).qid, "green");
  assert.equal(t.match("city", "bottlenecks at 5pm").params.hour, 17);
  assert.equal(t.match("city", "xyzzy"), null);
});
