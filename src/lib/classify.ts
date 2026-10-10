export type ManpowerClass = "LOW" | "EXCESS" | "OK";

export interface Thresholds {
  mode: "absolute" | "percent";
  low: number; // absolute headcount
  excess: number; // absolute headcount
  lowPct: number;
  excessPct: number;
}

// Management rule: a shift needs ad-hoc manpower (LOW) when the actual headcount is 10% or more
// below what was planned. The same 10% is used to flag EXCESS (shown on the dashboard, never emailed).
export const DEFAULT_THRESHOLDS: Thresholds = {
  mode: "percent",
  low: 10,
  excess: 10,
  lowPct: 10,
  excessPct: 10,
};

/** AD-HOC MANPOWER NEEDED = Planned - Actual. Positive means short, negative means excess. */
export const adhocNeeded = (planned: number, actual: number) => planned - actual;

/**
 * Gap vs plan, in percent of planned: (Planned - Actual) / Planned x 100.
 * Positive = short of plan, negative = above plan. Null when nothing was planned.
 */
export function gapPercent(planned: number, actual: number): number | null {
  return planned > 0 ? ((planned - actual) / planned) * 100 : null;
}

/**
 * LOW    : the gap is at least the low threshold    (boundary inclusive)
 * EXCESS : the excess is at least the excess threshold (boundary inclusive)
 * In percent mode (the default) the thresholds are a share of planned, e.g. 10% => LOW when
 * actual <= 90% of planned. If planned is 0 the absolute headcount thresholds are used instead.
 * Percent vs headcount is a setting, and can be overridden for a single hub.
 */
export function classify(planned: number, actual: number, t: Thresholds): ManpowerClass {
  const need = adhocNeeded(planned, actual);
  if (need === 0) return "OK";
  if (t.mode === "percent" && planned > 0) {
    if (need > 0 && need >= (planned * t.lowPct) / 100) return "LOW";
    if (need < 0 && -need >= (planned * t.excessPct) / 100) return "EXCESS";
    return "OK";
  }
  if (need >= t.low) return "LOW";
  if (need <= -t.excess) return "EXCESS";
  return "OK";
}
