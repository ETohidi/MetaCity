import { test } from "node:test";
import assert from "node:assert/strict";
import { MEASURED, segments } from "../src/engine/country.js";
import { links } from "../src/engine/city.js";
import { Twin } from "../src/engine/twin.js";

test("most motorway segments carry measured BASt volumes, the rest say they are illustrative", () => {
  assert.ok(MEASURED.count >= 30, `only ${MEASURED.count} measured segments`);
  for (const s of segments) {
    assert.ok(["measured", "illustrative"].includes(s.source.kind));
    assert.ok(s.aadt > 5000 && s.aadt < 200000, `${s.id}: ${s.aadt}`);
    assert.ok(s.hgv > 0 && s.hgv < 0.5, `${s.id}: truck share ${s.hgv}`);
  }
});

test("city streets take lanes and speed limits from OpenStreetMap where mapped", () => {
  const osm = links.filter((l) => l.source.kind === "osm");
  assert.ok(osm.length >= 20);
  for (const l of osm) assert.ok(l.kmh >= 30 && l.kmh <= 100 && l.cap >= 500, `${l.id}: ${l.kmh} km/h, ${l.cap} veh/h`);
});

test("the city model is checked against the real counting stations around Aachen", () => {
  const a = new Twin().ask("city", "realcounts");
  assert.ok(a.table.rows.length >= 3);
  for (const row of a.table.rows) {
    const ratio = Number(row[3]);
    assert.ok(ratio > 0.5 && ratio < 2, `${row[0]}: model/count ${ratio}`);
  }
});

test("every BASt station on the map has a position, a recent year and a plausible count", async () => {
  const { stations } = await import("../src/engine/country.js");
  assert.ok(stations.length > 1000);
  for (const s of stations) {
    assert.ok(s.lat > 47 && s.lat < 55.2 && s.lon > 5.8 && s.lon < 15.1, `${s.id} ${s.name}: ${s.lat},${s.lon}`);
    assert.ok(s.year >= 2020 && s.dtv > 0, `${s.id}: ${s.year} ${s.dtv}`);
  }
});
