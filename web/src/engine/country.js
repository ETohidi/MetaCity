// Level 1: the country twin. Statistical, not simulated: each motorway segment's annual
// average daily traffic is spread over the day with typical profiles, which gives hourly
// load, speed, CO2 and congestion hours. Planning questions are answered by changing the
// inputs (growth, freight shifted to rail, a speed limit) and recomputing.

import { CITY_BY_ID, CITIES, SEGMENTS } from "../data/germany-roads.js";
import { carCo2Kg, hgvCo2Kg } from "./emissions.js";
import { haversineKm } from "./geo.js";
import { HGV_PROFILE, MOTORWAY_PROFILE, peakDirShare } from "./profiles.js";

const LANE_CAP_PCU = 1700; // passenger-car units per lane and hour
const HGV_PCU = 2;
const DETOUR = 1.18; // road length over straight-line distance
const UNLIMITED_KMH = 128; // mean car speed in free flow on unlimited stretches
const WORKDAYS = 250;

export const BASE_OPTIONS = Object.freeze({ growth: 0, railShift: 0, railShiftOn: null, speedLimit: null });

export const segments = SEGMENTS.map((s) => {
  const a = CITY_BY_ID[s.from];
  const b = CITY_BY_ID[s.to];
  return {
    ...s,
    name: `${s.road} ${a.name} – ${b.name}`,
    lengthKm: Math.round(haversineKm(a, b) * DETOUR),
    capPcuPerDir: s.lanes * LANE_CAP_PCU,
  };
});

export const cities = CITIES;
export const SEG_BY_ID = Object.fromEntries(segments.map((s) => [s.id, s]));

function freeCarKmh(seg, opts) {
  const now = seg.limit ? seg.limit * 0.95 : UNLIMITED_KMH;
  return opts.speedLimit ? Math.min(now, opts.speedLimit * 0.95) : now;
}

/** Daily cars and HGVs on a segment after the scenario's growth and rail shift. */
function dailyVolumes(seg, opts) {
  const total = seg.aadt * (1 + (opts.growth || 0));
  const shiftHere = opts.railShift && (!opts.railShiftOn || opts.railShiftOn === seg.id || opts.railShiftOn === seg.road);
  const hgv = total * seg.hgv * (shiftHere ? 1 - opts.railShift : 1);
  const cars = total * (1 - seg.hgv);
  return { cars, hgv };
}

/** Load in one hour, peak direction. */
export function segmentHour(seg, hour, opts = BASE_OPTIONS) {
  const { cars, hgv } = dailyVolumes(seg, opts);
  const dir = peakDirShare(hour);
  const carsH = cars * MOTORWAY_PROFILE[hour] * dir;
  const hgvH = hgv * HGV_PROFILE[hour] * dir;
  const vc = (carsH + hgvH * HGV_PCU) / seg.capPcuPerDir;
  const free = freeCarKmh(seg, opts);
  // Speed falls off steeply once demand nears capacity (a BPR-shaped curve).
  const kmh = free / (1 + 0.25 * vc ** 6);
  return { hour, vehPerHour: carsH + hgvH, vc, kmh };
}

/** Whole-day and whole-year figures for one segment. */
export function segmentYear(seg, opts = BASE_OPTIONS) {
  const { cars, hgv } = dailyVolumes(seg, opts);
  let co2PerDay = 0;
  let congestedHours = 0;
  let peak = null;
  for (let h = 0; h < 24; h++) {
    const hr = segmentHour(seg, h, opts);
    if (!peak || hr.vc > peak.vc) peak = hr;
    if (hr.vc > 0.85) congestedHours += 1;
    const carKm = cars * MOTORWAY_PROFILE[h] * seg.lengthKm;
    const hgvKm = hgv * HGV_PROFILE[h] * seg.lengthKm;
    co2PerDay += carKm * carCo2Kg(hr.kmh) + hgvKm * hgvCo2Kg(Math.min(hr.kmh, 85));
  }
  return {
    id: seg.id,
    aadt: cars + hgv,
    hgvPerDay: hgv,
    vktPerYear: (cars + hgv) * seg.lengthKm * 365,
    co2TonnesPerYear: (co2PerDay * 365) / 1000,
    peakVc: peak.vc,
    peakHour: peak.hour,
    congestedHoursPerYear: congestedHours * WORKDAYS,
  };
}

/** Network totals plus a row per segment. */
export function countryYear(opts = BASE_OPTIONS) {
  const rows = segments.map((s) => ({ seg: s, ...segmentYear(s, opts) }));
  const sum = (fn) => rows.reduce((n, r) => n + fn(r), 0);
  return {
    rows,
    vktPerYear: sum((r) => r.vktPerYear),
    co2TonnesPerYear: sum((r) => r.co2TonnesPerYear),
    hgvKmPerDay: sum((r) => r.hgvPerDay * r.seg.lengthKm),
    congestedHoursPerYear: sum((r) => r.congestedHoursPerYear),
    overCapacity: rows.filter((r) => r.peakVc > 1).length,
  };
}

/** The segments that touch a city, for the hand-over to the level below. */
export const segmentsAt = (cityId) => segments.filter((s) => s.from === cityId || s.to === cityId);
