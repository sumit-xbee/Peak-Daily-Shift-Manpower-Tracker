export type ManpowerClass = "LOW" | "EXCESS" | "OK";

export interface Thresholds {
  mode: "absolute" | "percent";
  low: number; // absolute headcount
  excess: number; // absolute headcount
  lowPct: number;
  excessPct: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  mode: "absolute",
  low: 10,
  excess: 10,
  lowPct: 10,
  excessPct: 10,
};

/** AD-HOC MANPOWER NEEDED = Planned - Actual. Positive means short, negative means excess. */
export const adhocNeeded = (planned: number, actual: number) => planned - actual;

/**
 * LOW    : ad-hoc needed >= low threshold    (boundary inclusive)
 * EXCESS : ad-hoc needed <= -excess threshold (boundary inclusive)
 * In percent mode the thresholds are a share of planned; if planned is 0 the
 * absolute thresholds are used instead.
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
