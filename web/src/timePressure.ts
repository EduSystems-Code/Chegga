// Chegga Web — time-pressure banding (Phase 2; full breakdown query is Phase 3)
//
// Ported from Chegga's own `app/services/time_pressure_service.py::band_for`.
// Same fixed bands, same fraction-of-base-time-remaining logic.

import { parseTimeControlBaseSeconds } from "./clockParser";

// (label, fraction-of-base-time-remaining lower bound inclusive, upper bound exclusive)
const BANDS: [string, number, number][] = [
  ["critical (<10% time left)", 0.0, 0.1],
  ["low (10-30%)", 0.1, 0.3],
  ["comfortable (30-70%)", 0.3, 0.7],
  ["plenty (>70%)", 0.7, 10.0],
];

/** Correspondence/daily games and moves missing a %clk annotation both
 * yield undefined — there's no meaningful "time pressure" to bucket. */
export function bandFor(clockSeconds: number | undefined, timeControl: string): string | undefined {
  if (clockSeconds === undefined) return undefined;
  const base = parseTimeControlBaseSeconds(timeControl);
  if (!base) return undefined;
  const fraction = clockSeconds / base;
  for (const [label, lo, hi] of BANDS) {
    if (fraction >= lo && fraction < hi) return label;
  }
  return undefined;
}
