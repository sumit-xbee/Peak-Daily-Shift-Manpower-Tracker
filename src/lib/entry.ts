import { applyAlert } from "./alerts";
import { classify, gapPercent, type ManpowerClass } from "./classify";
import { configForHub, isAllowedEmail, loadConfig, loadOverrides, loadRawConfig, buildConfig } from "./config";
import { db, must } from "./db";
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
  | { ok: false; error: string; needsConfirm?: false }
  | { ok: false; needsConfirm: true; warnings: string[]; error?: undefined };

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

  const rounds = await loadRoundsByIds(ids);
  if (rounds.length !== ids.length) return { ok: false, error: "Unknown shift." };
  const summaries = await loadEntrySummaries(ids);

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
      reason: typeof it.reason === "string" && REASONS.includes(it.reason) ? it.reason : null,
      cutoffAt: new Date(round.cutoff_at), hubCfg, hubId: shift.hub.id,
      prevPlanned: prev ? prev.planned : null,
      same: Boolean(prev && prev.planned === planned && prev.actual === actual),
    });
  }

  if (warnings.length && !inp.confirm) return { ok: false, needsConfirm: true, warnings };

  const saved: SavedItem[] = [];
  for (const p of prepared) {
    if (!p.same) {
      must(
        await db().from("entries").insert({
          round_id: p.round.id, planned: p.planned, actual: p.actual, entered_by_email: email, source: inp.source,
          token_id: inp.tokenId ?? null, reason_code: p.reason, is_late: now.getTime() > p.cutoffAt.getTime(),
          plan_changed: p.prevPlanned !== null && p.prevPlanned !== p.planned,
          ip: inp.ip ?? null, user_agent: (inp.userAgent ?? "").slice(0, 300) || null,
        }),
        "save entry",
      );
    }
    const shift = master.shifts.get(p.round.hub_shift_id)!;
    const cls = await applyAlert({
      cfg: p.hubCfg, master, hub: shift.hub, roundId: p.round.id, label: p.label, cutoffAt: p.cutoffAt,
      planned: p.planned, actual: p.actual, enteredBy: email, enteredAt: now,
    });
    saved.push({ roundId: p.round.id, hub: p.hubName, label: p.label, planned: p.planned, actual: p.actual, adhoc: p.planned - p.actual, cls, unchanged: p.same });
  }
  return { ok: true, saved };
}

export { loadConfig };
