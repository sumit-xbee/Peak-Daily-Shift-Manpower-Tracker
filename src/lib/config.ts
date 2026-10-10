import { DEFAULT_THRESHOLDS, type Thresholds } from "./classify";
import { cached, invalidateCaches } from "./cache";
import { db, selectAll } from "./db";
import type { Offsets } from "./schedule";

export interface Config {
  systemEnabled: boolean;
  enabledSince: Date | null;
  dryRun: boolean;
  dryRunTo: string;
  appBaseUrl: string;
  tzOff: number;
  thresholds: Thresholds;
  offsets: Offsets;
  tokenTtlHoursAfterCutoff: number;
  ackRequiredLow: boolean;
  ackWindowMin: number;
  firstEmailTo: string[];
  alertRecipientsLow: string[];
  alertRecipientsExcess: string[];
  statusBoardScope: "zone" | "all" | "own";
  digestTimeIst: string;
  allowedDomains: string[];
  senderDisplayName: string;
  replyTo: string;
  dailySendCap: number;
  capWarnPct: number;
  sanityMax: number;
  placeholderEmails: string[];
  /** the morning report to POC3 (regional managers) about yesterday */
  poc3ReportEnabled: boolean;
  poc3ReportTimeIst: string;
}

type Raw = Record<string, unknown>;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const strArr = (v: unknown, d: string[]) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : d) as string[];

/** Build a typed Config from key/value pairs; every key has a safe default. */
export function buildConfig(r: Raw): Config {
  const since = typeof r.enabled_since === "string" ? new Date(r.enabled_since) : null;
  // default rule: LOW when actual is 10% or more below planned
  const mode = r.threshold_mode === "absolute" ? "absolute" : "percent";
  const scope = r.status_board_scope === "all" || r.status_board_scope === "own" ? r.status_board_scope : "zone";
  return {
    systemEnabled: bool(r.system_enabled, true),
    enabledSince: since && !Number.isNaN(since.getTime()) ? since : null,
    dryRun: bool(r.dry_run, true),
    dryRunTo: str(r.dry_run_to, ""),
    appBaseUrl: (process.env.APP_BASE_URL || str(r.app_base_url, "")).replace(/\/+$/, ""),
    tzOff: num(r.timezone_offset_min, 330),
    thresholds: {
      mode,
      low: num(r.low_threshold, DEFAULT_THRESHOLDS.low),
      excess: num(r.excess_threshold, DEFAULT_THRESHOLDS.excess),
      lowPct: num(r.low_pct, DEFAULT_THRESHOLDS.lowPct),
      excessPct: num(r.excess_pct, DEFAULT_THRESHOLDS.excessPct),
    },
    offsets: {
      roundOpen: num(r.round_open_offset_min, 30),
      reminder: num(r.reminder_offset_min, 60),
      l3: num(r.l3_escalation_offset_min, 60),
      rmOps: num(r.zone_rm_ops_escalation_offset_min, 120),
      cutoff: num(r.cutoff_offset_min, 240),
    },
    tokenTtlHoursAfterCutoff: num(r.token_ttl_hours_after_cutoff, 24),
    ackRequiredLow: bool(r.ack_required_low, true),
    ackWindowMin: num(r.ack_window_min, 30),
    firstEmailTo: strArr(r.first_email_to, ["POC1", "POC2"]),
    alertRecipientsLow: strArr(r.alert_recipients_low, ["ZONE_HR", "OPS_HEAD", "ZONE_RM"]),
    // EXCESS is shown on the dashboard but not emailed to anyone (management decision)
    alertRecipientsExcess: strArr(r.alert_recipients_excess, []),
    statusBoardScope: scope,
    digestTimeIst: str(r.digest_time_ist, "07:00"),
    allowedDomains: strArr(r.allowed_email_domains, ["xpressbees.com", "xpressbees.in"]).map((d) => d.toLowerCase()),
    senderDisplayName: str(r.sender_display_name, "XB Peak Shift Tracker"),
    replyTo: str(r.reply_to, ""),
    dailySendCap: num(r.daily_send_cap, 1500),
    capWarnPct: num(r.cap_warn_pct, 80),
    sanityMax: num(r.sanity_max_headcount, 2000),
    placeholderEmails: strArr(r.placeholder_emails, []).map((e) => e.toLowerCase()),
    poc3ReportEnabled: bool(r.poc3_report_enabled, true),
    poc3ReportTimeIst: str(r.poc3_report_time_ist, "06:00"),
  };
}

/** Settings change rarely, so pages may use a copy up to 20 s old. The scheduler and writers pass fresh = true. */
export async function loadRawConfig(fresh = false): Promise<Raw> {
  return cached(
    "config",
    20_000,
    async () => {
      const rows = await selectAll<{ key: string; value: unknown }>("app_config", "key,value");
      return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Raw;
    },
    fresh,
  );
}

export async function loadConfig(fresh = false): Promise<Config> {
  return buildConfig(await loadRawConfig(fresh));
}

export async function loadOverrides(fresh = false): Promise<Map<string, Raw>> {
  return cached(
    "overrides",
    20_000,
    async () => {
      const rows = await selectAll<{ hub_id: string; key: string; value: unknown }>("config_override", "hub_id,key,value");
      const m = new Map<string, Raw>();
      for (const r of rows) {
        const cur = m.get(r.hub_id) ?? {};
        cur[r.key] = r.value;
        m.set(r.hub_id, cur);
      }
      return m;
    },
    fresh,
  );
}

/** Global config with one hub's overrides applied (thresholds and time offsets only). */
export function configForHub(base: Config, raw: Raw, overrides: Map<string, Raw>, hubId: string): Config {
  const o = overrides.get(hubId);
  if (!o) return base;
  return buildConfig({ ...raw, ...o });
}

export function isAllowedEmail(email: string, cfg: Pick<Config, "allowedDomains">): boolean {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(e) || e.split("@").length !== 2) return false;
  return cfg.allowedDomains.includes(e.split("@")[1]);
}

export async function clearConfigOverride(hubId: string, key: string, by: string) {
  invalidateCaches();
  const d = db();
  const old = await d.from("config_override").select("value").eq("hub_id", hubId).eq("key", key).maybeSingle();
  await d.from("config_override").delete().eq("hub_id", hubId).eq("key", key);
  await d.from("config_history").insert({ key, hub_id: hubId, old_value: old.data?.value ?? null, new_value: null, changed_by: by });
}

export async function setConfigValue(key: string, value: unknown, by: string, hubId?: string) {
  invalidateCaches();
  const d = db();
  if (hubId) {
    const old = await d.from("config_override").select("value").eq("hub_id", hubId).eq("key", key).maybeSingle();
    await d.from("config_override").upsert({ hub_id: hubId, key, value });
    await d.from("config_history").insert({ key, hub_id: hubId, old_value: old.data?.value ?? null, new_value: value, changed_by: by });
    return;
  }
  const old = await d.from("app_config").select("value").eq("key", key).maybeSingle();
  await d.from("app_config").upsert({ key, value, updated_at: new Date().toISOString(), updated_by: by });
  await d.from("config_history").insert({ key, old_value: old.data?.value ?? null, new_value: value, changed_by: by });
  // turning the system back on must not open rounds that were missed while it was off
  if (key === "system_enabled" && value === true && old.data?.value !== true) {
    await d.from("app_config").upsert({ key: "enabled_since", value: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by: by });
  }
}
