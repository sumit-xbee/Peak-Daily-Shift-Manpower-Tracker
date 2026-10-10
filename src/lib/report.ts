// The morning report to POC3 (regional managers): yesterday's shifts of their hubs, with the
// shifts that needed ad-hoc manpower (LOW) highlighted and everything ranked by the size of the
// gap against the plan.
import { gapPercent } from "./classify";
import type { RoundView } from "./rounds";

export type ReportStatus = "LOW" | "EXCESS" | "OK" | "NO_ENTRY";

export interface ReportRow {
  hub: string;
  zone: string;
  label: string;
  planned: number | null;
  actual: number | null;
  /** planned - actual; positive = more people needed */
  need: number | null;
  /** (planned - actual) / planned x 100; positive = short of plan, negative = above plan */
  gapPct: number | null;
  status: ReportStatus;
}

export interface ReportTotals {
  shifts: number;
  entered: number;
  noEntry: number;
  low: number;
  excess: number;
  /** people still needed across the LOW shifts */
  peopleShort: number;
}

const rowOf = (v: RoundView): ReportRow => {
  const e = v.entry?.latest;
  if (!e) {
    return { hub: v.shift.hub.name, zone: v.shift.hub.zone.name, label: v.label, planned: null, actual: null, need: null, gapPct: null, status: "NO_ENTRY" };
  }
  return {
    hub: v.shift.hub.name,
    zone: v.shift.hub.zone.name,
    label: v.label,
    planned: e.planned,
    actual: e.actual,
    need: e.planned - e.actual,
    gapPct: gapPercent(e.planned, e.actual),
    status: v.cls ?? "OK",
  };
};

/**
 * Entered shifts first, biggest gap % first (so the worst hubs are on top and the LOW ones form the
 * head of the list); shifts with no plan to measure against follow; shifts with no entry come last.
 */
export function rankRows(views: RoundView[]): ReportRow[] {
  const rows = views.map(rowOf);
  const entered = rows.filter((r) => r.status !== "NO_ENTRY");
  const withPct = entered.filter((r) => r.gapPct !== null);
  const noPct = entered.filter((r) => r.gapPct === null);
  const none = rows.filter((r) => r.status === "NO_ENTRY");
  const byName = (a: ReportRow, b: ReportRow) => a.hub.localeCompare(b.hub) || a.label.localeCompare(b.label);
  withPct.sort((a, b) => (b.gapPct as number) - (a.gapPct as number) || (b.need as number) - (a.need as number) || byName(a, b));
  noPct.sort(byName);
  none.sort(byName);
  return [...withPct, ...noPct, ...none];
}

export function reportTotals(rows: ReportRow[]): ReportTotals {
  const t: ReportTotals = { shifts: rows.length, entered: 0, noEntry: 0, low: 0, excess: 0, peopleShort: 0 };
  for (const r of rows) {
    if (r.status === "NO_ENTRY") t.noEntry++;
    else t.entered++;
    if (r.status === "LOW") {
      t.low++;
      t.peopleShort += r.need ?? 0;
    }
    if (r.status === "EXCESS") t.excess++;
  }
  return t;
}

export const fmtPct = (p: number | null) => (p === null ? "-" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`);
