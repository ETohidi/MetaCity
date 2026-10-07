// Speed-dependent CO2 per vehicle-km, a smooth curve shaped like the usual emission-factor
// tables: high in stop-and-go traffic, lowest around 60-80 km/h, rising again at high speed.

export function carCo2Kg(kmh) {
  const v = Math.max(5, kmh);
  return 0.09 + 3 / v + 0.0000075 * v * v;
}

export function hgvCo2Kg(kmh) {
  const v = Math.max(5, kmh);
  return 0.55 + 12 / v + 0.00002 * v * v;
}

/** CO2 in kg for `vkm` vehicle-km at `kmh` with heavy-goods share `hgv`. */
export function co2Kg(vkm, kmh, hgv) {
  return vkm * ((1 - hgv) * carCo2Kg(kmh) + hgv * hgvCo2Kg(Math.min(kmh, 85)));
}
