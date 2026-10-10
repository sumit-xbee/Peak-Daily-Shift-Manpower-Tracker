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
];

export const OVERRIDE_KEYS = CONFIG_DEFS.filter((d) => d.perHub).map((d) => d.key);

export function parseValue(def: ConfigDef, text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (def.type) {
    case "bool": return { ok: true, value: text === "true" };
    case "int": {
      if (!/^\d{1,6}$/.test(text.trim())) return { ok: false, error: "Enter a whole number." };
      return { ok: true, value: Number(text.trim()) };
    }
    case "list": return { ok: true, value: text.split(",").map((s) => s.trim()).filter(Boolean) };
    default: return { ok: true, value: text.trim() };
  }
}

export function showValue(def: ConfigDef, v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "true" : "false";
  return v === null || v === undefined ? "" : String(v);
}
