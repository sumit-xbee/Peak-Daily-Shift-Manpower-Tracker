import type { EntryRowProps } from "@/components/EntryForm";
import { db } from "./db";
import { loadEntrySummaries, type RoundView } from "./rounds";
import { fmtDateTime } from "./time";

/** The plan most recently entered for the same hub shift on an earlier day (a typing shortcut, never forced). */
export async function lastPlanHint(hubShiftId: string, beforeDate: string): Promise<number | null> {
  const { data } = await db().from("rounds").select("id").eq("hub_shift_id", hubShiftId).lt("round_date", beforeDate).order("round_date", { ascending: false }).limit(5);
  if (!data?.length) return null;
  const sums = await loadEntrySummaries(data.map((r) => r.id as string));
  for (const r of data) {
    const e = sums.get(r.id as string);
    if (e) return e.latest.planned;
  }
  return null;
}

export async function toEntryRows(views: RoundView[]): Promise<EntryRowProps[]> {
  const rows: EntryRowProps[] = [];
  for (const v of views) {
    rows.push({
      roundId: v.round.id,
      hub: v.shift.hub.name,
      zone: v.shift.hub.zone.name,
      label: v.label,
      cutoffText: fmtDateTime(v.times.cutoffAt, v.cfg.tzOff).split(", ")[1],
      planned: v.entry ? v.entry.latest.planned : null,
      actual: v.entry ? v.entry.latest.actual : null,
      hintPlan: v.entry ? null : await lastPlanHint(v.shift.id, v.round.round_date),
      thresholds: v.cfg.thresholds,
      alreadyEntered: Boolean(v.entry),
    });
  }
  return rows;
}
