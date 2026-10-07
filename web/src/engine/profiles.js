// Typical weekday profiles: the share of a day's traffic that falls in each hour, and for
// urban traffic the share of trips heading out from home (to work, school, shops).
// Every level uses the same clock, so the country map, the city model and the street
// simulation all show the same time of day.

const normalise = (xs) => {
  const total = xs.reduce((a, b) => a + b, 0);
  return xs.map((x) => x / total);
};

export const URBAN_PROFILE = normalise([
  0.008, 0.005, 0.004, 0.004, 0.007, 0.02, 0.05, 0.08, 0.075, 0.058, 0.055, 0.058, 0.062, 0.062, 0.064, 0.072, 0.08,
  0.08, 0.066, 0.048, 0.035, 0.028, 0.02, 0.013,
]);

/** Share of the hour's trips that go from home to an activity (the rest come back). */
export const OUTBOUND_SHARE = [
  0.5, 0.5, 0.5, 0.5, 0.6, 0.85, 0.9, 0.88, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.3, 0.22, 0.2, 0.25, 0.35, 0.4, 0.35,
  0.3, 0.4,
];

export const MOTORWAY_PROFILE = normalise([
  0.012, 0.008, 0.007, 0.008, 0.013, 0.03, 0.055, 0.07, 0.065, 0.055, 0.052, 0.053, 0.055, 0.056, 0.058, 0.065, 0.072,
  0.07, 0.058, 0.045, 0.035, 0.028, 0.022, 0.016,
]);

export const HGV_PROFILE = normalise([
  0.025, 0.022, 0.022, 0.025, 0.033, 0.045, 0.055, 0.06, 0.06, 0.06, 0.06, 0.058, 0.056, 0.056, 0.055, 0.052, 0.048,
  0.042, 0.036, 0.03, 0.028, 0.027, 0.026, 0.025,
]);

/** Peak-direction share on motorways: commuter peaks are lopsided, the rest of the day is even. */
export const peakDirShare = (hour) => ((hour >= 6 && hour <= 9) || (hour >= 15 && hour <= 18) ? 0.56 : 0.5);

export const DAY = 24 * 3600;

/** "07:05" for a time in seconds since midnight. */
export function hhmm(t) {
  const s = ((Math.floor(t) % DAY) + DAY) % DAY;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
