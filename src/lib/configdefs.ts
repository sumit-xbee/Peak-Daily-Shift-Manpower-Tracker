// Describes every setting shown on the Settings page. Client-safe (no server imports).
export type DefType = "bool" | "int" | "text" | "select" | "list";

export interface ConfigDef {
  key: string;
  label: string;
  help?: string;
  type: DefType;
  options?: string[];
  group: string;
  /** can be overridden for a single hub */
  perHub?: boolean;
}

export const CONFIG_DEFS: ConfigDef[] = [
  { group: "Master switches", key: "system_enabled", label: "System ON", type: "bool", help: "OFF stops new rounds and all emails. Data is kept. Turning it back ON never back-fills rounds missed while it was off." },
  { group: "Master switches", key: "dry_run", label: "Dry run (test mode)", type: "bool", help: "ON: every email goes to the address below instead of the real person. Turn OFF to go live." },
  { group: "Master switches", key: "dry_run_to", label: "Dry-run address", type: "text", help: "Where test emails are delivered." },

  { group: "Alert thresholds", key: "threshold_mode", label: "Threshold mode", type: "select", options: ["percent", "absolute"], perHub: true, help: "percent (current rule) = share of the planned manpower; absolute = a fixed headcount." },
  { group: "Alert thresholds", key: "low_pct", label: "LOW (ad-hoc needed) when actual is this % or more BELOW planned", type: "int", perHub: true, help: "Current rule: 10, i.e. actual is 90% of planned or less. HR is alerted." },
  { group: "Alert thresholds", key: "excess_pct", label: "EXCESS when actual is this % or more ABOVE planned", type: "int", perHub: true, help: "Shown on the dashboard only. Nobody is emailed for excess." },
  { group: "Alert thresholds", key: "low_threshold", label: "(headcount mode) LOW if short by at least", type: "int", perHub: true, help: "Only used when the mode is absolute, or when nothing was planned." },
  { group: "Alert thresholds", key: "excess_threshold", label: "(headcount mode) EXCESS if above by at least", type: "int", perHub: true, help: "Only used when the mode is absolute, or when nothing was planned." },

  { group: "Timings (minutes)", key: "round_open_offset_min", label: "Email goes out after shift start", type: "int", perHub: true, help: "Default 30." },
  { group: "Timings (minutes)", key: "reminder_offset_min", label: "Reminder after the first email", type: "int", perHub: true, help: "Default 60." },
  { group: "Timings (minutes)", key: "l3_escalation_offset_min", label: "Escalate to POC3 after the first email", type: "int", perHub: true, help: "Default 60." },
  { group: "Timings (minutes)", key: "zone_rm_ops_escalation_offset_min", label: "Escalate to Zone RM and Ops head after", type: "int", perHub: true, help: "Default 120." },
  { group: "Timings (minutes)", key: "cutoff_offset_min", label: "Cut-off (after this a shift counts as MISSED)", type: "int", perHub: true, help: "Default 240. Late entries are still accepted." },
  { group: "Timings (minutes)", key: "ack_window_min", label: "Zone HR must acknowledge LOW within", type: "int", help: "Default 30." },
  { group: "Timings (minutes)", key: "token_ttl_hours_after_cutoff", label: "Email link stays valid after cut-off (hours)", type: "int", help: "Default 24." },

  { group: "Who gets what", key: "first_email_to", label: "First email goes to", type: "list", help: "Comma separated: POC1, POC2, POC3." },
  { group: "Who gets what", key: "alert_recipients_low", label: "LOW alert goes to", type: "list", help: "From: ZONE_HR, ZONE_RM, OPS_HEAD, POC1, POC2, POC3." },
  { group: "Who gets what", key: "alert_recipients_excess", label: "EXCESS alert goes to", type: "list", help: "Empty = nobody is emailed. Management decision: excess is shown on the dashboard only." },
  { group: "Who gets what", key: "ack_required_low", label: "LOW alert needs acknowledgement", type: "bool" },
  { group: "Who gets what", key: "status_board_scope", label: "Entry page 'who has entered' board shows", type: "select", options: ["zone", "all", "own"] },

  { group: "Email", key: "sender_display_name", label: "Sender display name", type: "text" },
  { group: "Email", key: "reply_to", label: "Reply-To address (optional)", type: "text" },
  { group: "Email", key: "daily_send_cap", label: "Daily email cap", type: "int", help: "Google Workspace allows about 2,000 a day. At the cap only LOW alerts are sent." },
  { group: "Email", key: "cap_warn_pct", label: "Warn admin at this % of the cap", type: "int" },
  { group: "Email", key: "digest_time_ist", label: "Daily digest to Ops head and Zone RMs (IST, HH:MM)", type: "text" },
  { group: "Email", key: "poc3_report_enabled", label: "Morning report to POC3 (regional managers)", type: "bool", help: "Yesterday's shifts for the hubs under them, ranked by gap % against plan, ad-hoc (LOW) shifts highlighted." },
  { group: "Email", key: "poc3_report_time_ist", label: "POC3 report time (IST, HH:MM)", type: "text", help: "Default 06:00." },

  { group: "Other", key: "allowed_email_domains", label: "Allowed email domains", type: "list", help: "Comma separated, e.g. xpressbees.com, xpressbees.in" },
  { group: "Other", key: "placeholder_emails", label: "Placeholder POC emails", type: "list", help: "People who are only standing in; flagged in the POC Directory." },
  { group: "Other", key: "sanity_max_headcount", label: "Largest number accepted", type: "int" },
  { group: "Other", key: "login_known_people_only", label: "Dashboard login only for people in the master data", type: "bool", help: "ON: only POCs, Zone RM/HR, Ops head and admins can log in. OFF (current): any XB email can." },
];

export const OVERRIDE_KEYS = CONFIG_DEFS.filter((d) => d.perHub).map((d) => d.key);

/** Defaults for settings that may not exist in an older database yet (the app treats a missing setting as its default). */
export const CONFIG_DEFAULTS: Record<string, unknown> = {
  login_known_people_only: false,
  poc3_report_enabled: true,
  poc3_report_time_ist: "06:00",
};

// ---------------------------------------------------------------- validation (used by the form AND the server)
const ROLES = ["POC1", "POC2", "POC3", "ZONE_HR", "ZONE_RM", "OPS_HEAD", "SYSTEM_ADMIN"];
const RANGES: Record<string, [number, number]> = {
  low_pct: [1, 100], excess_pct: [1, 1000], low_threshold: [1, 100000], excess_threshold: [1, 100000],
  round_open_offset_min: [0, 1440], reminder_offset_min: [1, 1440], l3_escalation_offset_min: [1, 1440],
  zone_rm_ops_escalation_offset_min: [1, 1440], cutoff_offset_min: [10, 2880], ack_window_min: [1, 1440],
  token_ttl_hours_after_cutoff: [1, 720], daily_send_cap: [1, 100000], cap_warn_pct: [1, 100], sanity_max_headcount: [10, 100000],
};
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}$/;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Check a setting before it is saved. Only settings listed in CONFIG_DEFS can be written at all,
 * and per-hub overrides only for settings marked per-hub. Returns an error message, or null if fine.
 */
export function validateConfigValue(key: string, value: unknown, opts: { hub?: boolean; allowedDomains?: string[] } = {}): string | null {
  const def = CONFIG_DEFS.find((d) => d.key === key);
  if (!def) return "Unknown setting.";
  if (opts.hub && !def.perHub) return "This setting cannot be set per hub.";
  switch (def.type) {
    case "bool":
      return typeof value === "boolean" ? null : "Choose Yes or No.";
    case "int": {
      if (typeof value !== "number" || !Number.isInteger(value)) return "Enter a whole number.";
      const [lo, hi] = RANGES[key] ?? [0, 1_000_000];
      return value >= lo && value <= hi ? null : `Enter a number from ${lo} to ${hi}.`;
    }
    case "select":
      return typeof value === "string" && def.options?.includes(value) ? null : "Choose one of the listed options.";
    case "list": {
      if (!Array.isArray(value) || value.length > 20 || value.some((v) => typeof v !== "string" || v.length > 100 || !v.trim())) return "Enter up to 20 comma-separated values.";
      const items = value as string[];
      if (["first_email_to", "alert_recipients_low", "alert_recipients_excess"].includes(key)) {
        const bad = items.find((v) => !ROLES.includes(v));
        if (bad) return `"${bad}" is not a valid role. Use: ${ROLES.join(", ")}.`;
        if (key === "first_email_to" && items.length === 0) return "At least one person must get the first email.";
      }
      if (key === "allowed_email_domains") {
        if (items.length === 0) return "At least one email domain is required.";
        const bad = items.find((v) => !DOMAIN_RE.test(v.toLowerCase()));
        if (bad) return `"${bad}" is not a domain like xpressbees.com (no @ sign).`;
      }
      if (key === "placeholder_emails") {
        const bad = items.find((v) => !EMAIL_RE.test(v.toLowerCase()));
        if (bad) return `"${bad}" is not an email address.`;
      }
      return null;
    }
    default: {
      if (typeof value !== "string" || value.length > 200) return "Text is too long.";
      if (key === "digest_time_ist" || key === "poc3_report_time_ist") return HHMM_RE.test(value) ? null : "Use 24-hour time like 07:00.";
      if (key === "sender_display_name") return value.trim().length >= 1 && value.length <= 80 && !/[\r\n<>"]/.test(value) ? null : "Use 1-80 characters, no quotes or line breaks.";
      if (key === "reply_to" || key === "dry_run_to") {
        if (value === "") return key === "reply_to" ? null : "A dry-run address is required while dry run is on.";
        const e = value.trim().toLowerCase();
        if (!EMAIL_RE.test(e)) return "Enter a valid email address.";
        if (opts.allowedDomains && !opts.allowedDomains.includes(e.split("@")[1])) return "Use an address on an allowed XB domain.";
      }
      return null;
    }
  }
}

export function parseValue(def: ConfigDef, text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let value: unknown;
  switch (def.type) {
    case "bool": value = text === "true"; break;
    case "int":
      if (!/^\d{1,7}$/.test(text.trim())) return { ok: false, error: "Enter a whole number." };
      value = Number(text.trim());
      break;
    case "list": value = text.split(",").map((s) => s.trim()).filter(Boolean); break;
    default: value = text.trim();
  }
  const err = validateConfigValue(def.key, value);
  return err ? { ok: false, error: err } : { ok: true, value };
}

export function showValue(def: ConfigDef, v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "true" : "false";
  return v === null || v === undefined ? "" : String(v);
}
