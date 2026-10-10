import { classify, type ManpowerClass } from "./classify";
import { buildConfig, configForHub, type Config } from "./config";
import { chunk, db, selectAll } from "./db";
import { isSkipped, type HubShift, type Master } from "./master";
import { roundStatus, timesFromRound, type RoundStatus, type RoundTimes } from "./schedule";
import { shiftLabel } from "./time";

export interface RoundRow {
  id: string;
  hub_shift_id: string;
  round_date: string;
  shift_start: string;
  opens_at: string;
  cutoff_at: string;
}

export interface EntryRow {
  id: string;
  round_id: string;
  planned: number;
  actual: number;
  adhoc_needed: number;
  entered_by_email: string;
  source: "link" | "delegate" | "dashboard";
  reason_code: string | null;
  is_late: boolean;
  plan_changed: boolean;
  created_at: string;
}

export interface EntrySummary {
  first: EntryRow;
  latest: EntryRow;
  count: number;
  planChanged: boolean;
}

export interface RoundView {
  round: RoundRow;
  shift: HubShift;
  label: string;
  times: RoundTimes;
  cfg: Config; // resolved for this hub
  entry: EntrySummary | null;
  status: RoundStatus;
  cls: ManpowerClass | null;
}

export async function loadRoundsForDates(dates: string[]): Promise<RoundRow[]> {
  return selectAll<RoundRow>("rounds", "id,hub_shift_id,round_date,shift_start,opens_at,cutoff_at", (q) => q.in("round_date", dates));
}

export async function loadRoundsByIds(ids: string[]): Promise<RoundRow[]> {
  const out: RoundRow[] = [];
  for (const c of chunk(ids)) {
    const { data, error } = await db().from("rounds").select("id,hub_shift_id,round_date,shift_start,opens_at,cutoff_at").in("id", c);
    if (error) throw new Error(`load rounds: ${error.message}`);
    out.push(...((data ?? []) as RoundRow[]));
  }
  return out;
}

const ENTRY_COLS = "id,round_id,planned,actual,adhoc_needed,entered_by_email,source,reason_code,is_late,plan_changed,created_at";

/** Fold entries (oldest first) into one summary per round: the first, the latest, how many, whether the plan changed. */
function fold(map: Map<string, EntrySummary>, e: EntryRow) {
  const cur = map.get(e.round_id);
  if (!cur) map.set(e.round_id, { first: e, latest: e, count: 1, planChanged: e.plan_changed });
  else {
    cur.latest = e;
    cur.count++;
    cur.planChanged = cur.planChanged || e.plan_changed;
  }
}

export async function loadEntrySummaries(roundIds: string[]): Promise<Map<string, EntrySummary>> {
  const map = new Map<string, EntrySummary>();
  const page = 1000;
  for (const c of chunk(roundIds)) {
    for (let from = 0; ; from += page) {
      const { data, error } = await db()
        .from("entries")
        .select(ENTRY_COLS)
        .in("round_id", c)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + page - 1);
      if (error) throw new Error(`load entries: ${error.message}`);
      for (const e of (data ?? []) as EntryRow[]) fold(map, e);
      if (!data || data.length < page) break;
    }
  }
  return map;
}

/**
 * All entries of the rounds on the given dates, in ONE query (joined to their round's date).
 * Far fewer round trips than asking round by round.
 */
export async function loadEntrySummariesForDates(dates: string[]): Promise<Map<string, EntrySummary>> {
  const map = new Map<string, EntrySummary>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db()
      .from("entries")
      .select(`${ENTRY_COLS},rounds!inner(round_date)`)
      .in("rounds.round_date", dates)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`load entries by date: ${error.message}`);
    for (const row of (data ?? []) as (EntryRow & { rounds?: unknown })[]) {
      const { rounds: _joined, ...e } = row;
      void _joined;
      fold(map, e);
    }
    if (!data || data.length < page) break;
  }
  return map;
}

/**
 * Is this round still "live" for notifications and reports? A shift or hub switched off, or a date skipped,
 * AFTER the round was created must stop reminders and must not count as MISSED in the morning reports.
 */
export function isLiveRound(v: RoundView, master: Master): boolean {
  return v.shift.active && v.shift.hub.active && !isSkipped(master, v.shift.hub.id, v.shift.id, v.round.round_date);
}

export function buildViews(
  rounds: RoundRow[],
  entries: Map<string, EntrySummary>,
  master: Master,
  baseCfg: Config,
  rawCfg: Record<string, unknown>,
  overrides: Map<string, Record<string, unknown>>,
  now: Date,
): RoundView[] {
  const views: RoundView[] = [];
  for (const r of rounds) {
    const shift = master.shifts.get(r.hub_shift_id);
    if (!shift) continue;
    const cfg = configForHub(baseCfg, rawCfg, overrides, shift.hub.id);
    const times = timesFromRound(new Date(r.shift_start), new Date(r.opens_at), new Date(r.cutoff_at), cfg.offsets);
    const entry = entries.get(r.id) ?? null;
    const status = roundStatus({
      now,
      opensAt: times.opensAt,
      reminderAt: times.reminderAt,
      cutoffAt: times.cutoffAt,
      firstEntryAt: entry ? new Date(entry.first.created_at) : null,
    });
    views.push({
      round: r,
      shift,
      label: shiftLabel(shift.start, shift.end),
      times,
      cfg,
      entry,
      status,
      cls: entry ? classify(entry.latest.planned, entry.latest.actual, cfg.thresholds) : null,
    });
  }
  return views;
}

export { buildConfig };
