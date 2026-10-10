import { buildConfig, type Config } from "./config";
import { loadOverrides, loadRawConfig } from "./config";
import type { Poc3ReportRow } from "./emails";
import { loadMaster, type Person } from "./master";
import { fmtPct, rankRows, reportTotals, type ReportRow, type ReportTotals } from "./report";
import { buildViews, isLiveRound, loadEntrySummariesForDates, loadRoundsForDates, type RoundView } from "./rounds";

export interface Poc3Report {
  person: Person;
  hubCount: number;
  rows: ReportRow[];
  totals: ReportTotals;
}

/**
 * One report per POC3: every shift of every hub where that person is POC3, for the given date,
 * ranked by gap % (largest first). A person who is POC3 of several hubs gets one combined report.
 */
export async function loadPoc3Reports(date: string, now = new Date()): Promise<{ cfg: Config; reports: Poc3Report[] }> {
  const raw = await loadRawConfig(true);
  const cfg = buildConfig(raw);
  const [master, overrides, rounds, entries] = await Promise.all([loadMaster(true), loadOverrides(true), loadRoundsForDates([date]), loadEntrySummariesForDates([date])]);
  const views = buildViews(rounds, entries, master, cfg, raw, overrides, now);

  const byPerson = new Map<string, { person: Person; hubs: Set<string>; views: RoundView[] }>();
  for (const v of views) {
    if (v.status === "NOT_DUE" || !isLiveRound(v, master)) continue; // a switched-off hub or skipped day is not "missed"
    const p = v.shift.hub.pocs[2];
    const k = p.email.toLowerCase();
    const g = byPerson.get(k) ?? { person: p, hubs: new Set<string>(), views: [] };
    g.hubs.add(v.shift.hub.id);
    g.views.push(v);
    byPerson.set(k, g);
  }
  const reports = [...byPerson.values()]
    .map((g) => {
      const rows = rankRows(g.views);
      return { person: g.person, hubCount: g.hubs.size, rows, totals: reportTotals(rows) };
    })
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
  return { cfg, reports };
}

const MAX_ROWS = 60;

/**
 * Rows for the email. LOW, EXCESS and no-entry shifts are always shown; shifts that were on plan fill
 * whatever room is left, so a very large list never buries the problems. Ranks keep their true position.
 */
export function emailRows(rows: ReportRow[], max = MAX_ROWS): { rows: Poc3ReportRow[]; hidden: number } {
  let rank = 0;
  const ranked = rows.map((r) => ({ r, rank: r.status === "NO_ENTRY" ? null : ++rank }));
  const problems = ranked.filter((x) => x.r.status !== "OK").length;
  let room = Math.max(0, max - problems);
  const shown = ranked.filter((x) => {
    if (x.r.status !== "OK") return true;
    if (room > 0) {
      room--;
      return true;
    }
    return false;
  });
  const fmt = (n: number | null) => (n === null ? "-" : String(n));
  const need = (n: number | null) => (n === null ? "-" : n > 0 ? `+${n}` : String(n).replace("-", "−"));
  return {
    hidden: ranked.length - shown.length,
    rows: shown.map(({ r, rank: k }) => ({
      rank: k,
      hub: r.hub,
      zone: r.zone,
      label: r.label,
      planned: fmt(r.planned),
      actual: fmt(r.actual),
      need: need(r.need),
      gap: fmtPct(r.gapPct),
      status: r.status === "NO_ENTRY" ? "NO ENTRY" : r.status,
    })),
  };
}
