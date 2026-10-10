import type { EntryRowProps } from "@/components/EntryForm";
import { db, must } from "./db";
import type { RoundView } from "./rounds";
import { fmtDateTime } from "./time";

/**
 * The plan most recently entered for each hub shift on an earlier day (a typing shortcut, never forced).
 * ONE query for all shifts, instead of two per row.
 */
export async function lastPlanHints(shiftIds: string[], beforeDate: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!shiftIds.length) return out;
  const since = new Date(new Date(`${beforeDate}T00:00:00Z`).getTime() - 21 * 86400_000).toISOString().slice(0, 10);
  const rows = must(
    await db()
      .from("entries")
      .select("planned,created_at,rounds!inner(hub_shift_id,round_date)")
      .in("rounds.hub_shift_id", shiftIds)
      .lt("rounds.round_date", beforeDate)
      .gte("rounds.round_date", since)
      .order("created_at", { ascending: false })
      .limit(1000),
    "load plan hints",
  ) as unknown as { planned: number; rounds: { hub_shift_id: string } | { hub_shift_id: string }[] }[];
  for (const r of rows) {
    const rd = Array.isArray(r.rounds) ? r.rounds[0] : r.rounds;
    if (rd && !out.has(rd.hub_shift_id)) out.set(rd.hub_shift_id, r.planned); // newest first, so the first one seen is the latest
  }
  return out;
}

export async function toEntryRows(views: RoundView[]): Promise<EntryRowProps[]> {
  const needHint = views.filter((v) => !v.entry);
  const date = needHint[0]?.round.round_date;
  const hints = date ? await lastPlanHints([...new Set(needHint.map((v) => v.shift.id))], date) : new Map<string, number>();
  return views.map((v) => ({
    roundId: v.round.id,
    hub: v.shift.hub.name,
    zone: v.shift.hub.zone.name,
    label: v.label,
    cutoffText: fmtDateTime(v.times.cutoffAt, v.cfg.tzOff).split(", ")[1],
    planned: v.entry ? v.entry.latest.planned : null,
    actual: v.entry ? v.entry.latest.actual : null,
    hintPlan: v.entry ? null : (hints.get(v.shift.id) ?? null),
    thresholds: v.cfg.thresholds,
    alreadyEntered: Boolean(v.entry),
    status: v.status,
  }));
}
