import { buildConfig, loadOverrides, loadRawConfig, type Config } from "./config";
import { chunk, db } from "./db";
import { loadMaster, type Master } from "./master";
import { buildViews, loadEntrySummariesForDates, loadRoundsForDates, type RoundView } from "./rounds";
import { addDays, isDateStr, localDateStr } from "./time";

export interface AlertState {
  roundId: string;
  class: "LOW" | "EXCESS";
  ackRequired: boolean;
  ackedBy: string | null;
  ackedAt: string | null;
  ackEta: string | null;
  resolved: boolean;
}

export interface DayData {
  date: string;
  today: string;
  now: Date;
  cfg: Config;
  master: Master;
  views: RoundView[];
  alerts: Map<string, AlertState>; // open alert per round
}

export const pickDate = (param: string | undefined, today: string) => (param && isDateStr(param) ? param : today);

/** Everything a dashboard page needs for one calendar day (IST). */
export async function loadDay(dateParam?: string): Promise<DayData> {
  const now = new Date();
  const raw = await loadRawConfig(); // cached: usually no database trip at all
  const cfg = buildConfig(raw);
  const today = localDateStr(now, cfg.tzOff);
  const date = pickDate(dateParam, today);
  // everything else is asked for at the same time: one wait instead of four
  const [master, overrides, rounds, entries, alerts] = await Promise.all([
    loadMaster(),
    loadOverrides(),
    loadRoundsForDates([date]),
    loadEntrySummariesForDates([date]),
    loadAlertStatesForDates([date]),
  ]);
  const views = buildViews(rounds, entries, master, cfg, raw, overrides, now);
  return { date, today, now, cfg, master, views, alerts };
}

/** Open alerts of the rounds on the given dates, in one query. */
export async function loadAlertStatesForDates(dates: string[]): Promise<Map<string, AlertState>> {
  const out = new Map<string, AlertState>();
  const { data } = await db()
    .from("alerts")
    .select("round_id,class,ack_required,acked_by,acked_at,ack_eta,rounds!inner(round_date)")
    .in("rounds.round_date", dates)
    .is("resolved_at", null);
  for (const a of (data ?? []) as unknown as { round_id: string; class: "LOW" | "EXCESS"; ack_required: boolean; acked_by: string | null; acked_at: string | null; ack_eta: string | null }[]) {
    out.set(a.round_id, { roundId: a.round_id, class: a.class, ackRequired: a.ack_required, ackedBy: a.acked_by, ackedAt: a.acked_at, ackEta: a.ack_eta, resolved: false });
  }
  return out;
}

export async function loadAlertStates(roundIds: string[]): Promise<Map<string, AlertState>> {
  const out = new Map<string, AlertState>();
  for (const c of chunk(roundIds)) {
    const { data } = await db()
      .from("alerts")
      .select("round_id,class,ack_required,acked_by,acked_at,ack_eta,resolved_at,created_at")
      .in("round_id", c)
      .is("resolved_at", null);
    for (const a of (data ?? []) as { round_id: string; class: "LOW" | "EXCESS"; ack_required: boolean; acked_by: string | null; acked_at: string | null; ack_eta: string | null }[]) {
      out.set(a.round_id, { roundId: a.round_id, class: a.class, ackRequired: a.ack_required, ackedBy: a.acked_by, ackedAt: a.acked_at, ackEta: a.ack_eta, resolved: false });
    }
  }
  return out;
}

export const prevDay = (d: string) => addDays(d, -1);
export const nextDay = (d: string) => addDays(d, 1);

/** Sort: zone, hub, shift start. */
export function sortViews(v: RoundView[]): RoundView[] {
  return [...v].sort(
    (a, b) =>
      a.shift.hub.zone.name.localeCompare(b.shift.hub.zone.name) ||
      a.shift.hub.name.localeCompare(b.shift.hub.name) ||
      a.shift.start.localeCompare(b.shift.start),
  );
}

export const pocNames = (v: RoundView) => [...new Set(v.shift.hub.pocs.slice(0, 2).map((p) => p.name))].join(" / ");

export interface Totals {
  total: number;
  due: number; // opened
  entered: number;
  pending: number; // opened, no entry yet, not missed
  missed: number;
  low: number;
  excess: number;
  planned: number;
  actual: number;
  net: number;
  shortOnly: number;
  excessOnly: number;
}

export function totals(vs: RoundView[]): Totals {
  const t: Totals = { total: vs.length, due: 0, entered: 0, pending: 0, missed: 0, low: 0, excess: 0, planned: 0, actual: 0, net: 0, shortOnly: 0, excessOnly: 0 };
  for (const v of vs) {
    if (v.status !== "NOT_DUE") t.due++;
    if (v.entry) {
      t.entered++;
      const e = v.entry.latest;
      t.planned += e.planned;
      t.actual += e.actual;
      t.net += e.adhoc_needed;
      if (e.adhoc_needed > 0) t.shortOnly += e.adhoc_needed;
      if (e.adhoc_needed < 0) t.excessOnly += -e.adhoc_needed;
      if (v.cls === "LOW") t.low++;
      if (v.cls === "EXCESS") t.excess++;
    } else if (v.status === "OPEN" || v.status === "OVERDUE") t.pending++;
    else if (v.status === "MISSED") t.missed++;
  }
  return t;
}
