import { applyAlert } from "./alerts";
import { classify, gapPercent, type ManpowerClass } from "./classify";
import { configForHub, isAllowedEmail, loadConfig, loadOverrides, loadRawConfig, buildConfig } from "./config";
import { db, must, mustOk } from "./db";
import { loadMaster } from "./master";
import { loadRoundsByIds, loadEntrySummaries } from "./rounds";
import { shiftLabel } from "./time";

export interface EntryItem {
  roundId: string;
  planned: unknown;
  actual: unknown;
  reason?: unknown;
}

export interface SubmitInput {
  items: EntryItem[];
  email: string;
  source: "link" | "delegate" | "dashboard";
  tokenId?: string | null;
  /** when set, only these rounds may be written (link tokens) */
  allowedRoundIds?: string[];
  confirm: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export interface SavedItem {
  roundId: string;
  hub: string;
  label: string;
  planned: number;
  actual: number;
  adhoc: number;
  cls: ManpowerClass;
  unchanged: boolean;
}

export type SubmitResult =
  | { ok: true; saved: SavedItem[] }
  | { ok: false; error: string; needsConfirm?: false; status?: number }
  | { ok: false; needsConfirm: true; warnings: string[]; error?: undefined; status?: undefined };

/** One shift can be saved this many times an hour. Plenty for corrections; stops a script flooding HR with alerts. */
const MAX_SAVES_PER_ROUND_PER_HOUR = 20;

export const REASONS = ["Absenteeism", "Vendor no-show", "Late arrival", "Transport issue", "Higher volume than planned", "Other"];

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function toCount(v: unknown): number | null {
  if (typeof v === "number") return isCount(v) ? v : null;
  if (typeof v === "string" && /^\d{1,6}$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** Validate and save entries. Every save is a NEW row (history is kept). Alerts are raised or closed as needed. */
export async function submitEntries(inp: SubmitInput): Promise<SubmitResult> {
  const now = new Date();
  const raw = await loadRawConfig(true); // saving numbers decides alerts, so use the latest settings
  const cfg = buildConfig(raw);
  if (!cfg.systemEnabled) return { ok: false, error: "Tracking is paused right now." };
  if (!isAllowedEmail(inp.email, cfg)) return { ok: false, error: `Please enter your XB email (${cfg.allowedDomains.map((d) => "@" + d).join(" or ")}).` };
  if (!inp.items.length) return { ok: false, error: "Nothing to save." };
  if (inp.items.length > 100) return { ok: false, error: "Too many rows in one save." };

  const email = inp.email.trim().toLowerCase();
  const [master, overrides] = await Promise.all([loadMaster(true), loadOverrides(true)]);
  const ids = [...new Set(inp.items.map((i) => i.roundId))];
  if (ids.length !== inp.items.length) return { ok: false, error: "A shift appears twice in this save." };
  if (inp.allowedRoundIds && ids.some((id) => !inp.allowedRoundIds!.includes(id))) return { ok: false, error: "This link does not cover one of those shifts." };

  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const [rounds, summaries, recent] = await Promise.all([
    loadRoundsByIds(ids),
    loadEntrySummaries(ids),
    db().from("entries").select("round_id").in("round_id", ids).gte("created_at", hourAgo),
  ]);
  if (rounds.length !== ids.length) return { ok: false, error: "Unknown shift." };
  const perRound = new Map<string, number>();
  for (const r of must(recent, "count recent saves") as { round_id: string }[]) perRound.set(r.round_id, (perRound.get(r.round_id) ?? 0) + 1);
  if ([...perRound.values()].some((n) => n >= MAX_SAVES_PER_ROUND_PER_HOUR)) {
    return { ok: false, error: "This shift has been changed many times in the last hour. Please wait a little before saving again.", status: 429 };
  }

  const prepared: {
    round: (typeof rounds)[number]; planned: number; actual: number; reason: string | null;
    hubName: string; label: string; cutoffAt: Date; hubCfg: ReturnType<typeof configForHub>;
    prevPlanned: number | null; same: boolean; hubId: string;
  }[] = [];
  const warnings: string[] = [];

  for (const it of inp.items) {
    const round = rounds.find((r) => r.id === it.roundId)!;
    const shift = master.shifts.get(round.hub_shift_id);
    if (!shift) return { ok: false, error: "Unknown shift." };
    if (new Date(round.opens_at).getTime() > now.getTime()) return { ok: false, error: `${shift.hub.name} ${shiftLabel(shift.start, shift.end)} has not opened yet.` };
    const planned = toCount(it.planned);
    const actual = toCount(it.actual);
    const name = `${shift.hub.name} ${shiftLabel(shift.start, shift.end)}`;
    if (planned === null || actual === null) return { ok: false, error: `${name}: enter whole numbers (0 or more) for both Planned and Actual.` };
    const hubCfg = configForHub(cfg, raw, overrides, shift.hub.id);
    if (planned > hubCfg.sanityMax || actual > hubCfg.sanityMax) return { ok: false, error: `${name}: a number above ${hubCfg.sanityMax} is not accepted. Please check it.` };

    const prev = summaries.get(round.id)?.latest;
    const cls = classify(planned, actual, hubCfg.thresholds);
    const pct = gapPercent(planned, actual);
    const pctText = pct === null ? "" : ` (${Math.abs(pct).toFixed(1)}%)`;
    if (cls === "LOW") warnings.push(`${name}: ${planned - actual} short of plan${pctText}. Ad-hoc manpower is needed and HR will be alerted.`);
    if (cls === "EXCESS") warnings.push(`${name}: ${actual - planned} above plan${pctText}. It is shown on the dashboard; HR is not emailed for excess.`);
    if (planned === 0) warnings.push(`${name}: Planned is 0.`);
    if (actual === 0) warnings.push(`${name}: Actual is 0.`);

    prepared.push({
      round, planned, actual, hubName: shift.hub.name, label: shiftLabel(shift.start, shift.end),
      // a reason only makes sense for a shift that is LOW or EXCESS
      reason: cls !== "OK" && typeof it.reason === "string" && REASONS.includes(it.reason) ? it.reason : null,
      cutoffAt: new Date(round.cutoff_at), hubCfg, hubId: shift.hub.id,
      prevPlanned: prev ? prev.planned : null,
      same: Boolean(prev && prev.planned === planned && prev.actual === actual),
    });
  }

  if (warnings.length && !inp.confirm) return { ok: false, needsConfirm: true, warnings };

  // each shift is independent, so they are saved side by side (a POC saving 8 shifts should not wait for 8 in a row)
  const saved = await Promise.all(
    prepared.map(async (p): Promise<SavedItem> => {
      if (!p.same) {
        mustOk(
          await db().from("entries").insert({
            round_id: p.round.id, planned: p.planned, actual: p.actual, entered_by_email: email, source: inp.source,
            token_id: inp.tokenId ?? null, reason_code: p.reason, is_late: now.getTime() > p.cutoffAt.getTime(),
            plan_changed: p.prevPlanned !== null && p.prevPlanned !== p.planned,
            ip: inp.ip ?? null, user_agent: (inp.userAgent ?? "").slice(0, 300) || null,
          }),
          "save entry",
        );
      }
      // The alert follows the LATEST entry of the round, not just this request: if two people save at the same
      // moment, the alert must end up matching whatever was saved last.
      const latest = (
        must(await db().from("entries").select("planned,actual,entered_by_email,created_at").eq("round_id", p.round.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1), "read latest entry") as
          { planned: number; actual: number; entered_by_email: string; created_at: string }[]
      )[0];
      const shift = master.shifts.get(p.round.hub_shift_id)!;
      await applyAlert({
        cfg: p.hubCfg, master, hub: shift.hub, roundId: p.round.id, label: p.label, cutoffAt: p.cutoffAt,
        planned: latest?.planned ?? p.planned, actual: latest?.actual ?? p.actual,
        enteredBy: latest?.entered_by_email ?? email, enteredAt: latest ? new Date(latest.created_at) : now,
      });
      return {
        roundId: p.round.id, hub: p.hubName, label: p.label, planned: p.planned, actual: p.actual, adhoc: p.planned - p.actual,
        cls: classify(p.planned, p.actual, p.hubCfg.thresholds), unchanged: p.same,
      };
    }),
  );
  return { ok: true, saved };
}

export { loadConfig };
