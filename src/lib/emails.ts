// Email templates. One purpose and one button per email. Table layout and inline CSS so
// they render in Gmail, Outlook and mobile, with a plain-text twin for every message.
import { fmtDateTime } from "./time";

export type Band = "blue" | "amber" | "red" | "green" | "grey";

export interface EmailSpec {
  band: Band;
  tag: string; // short label in the coloured band, e.g. "ACTION NEEDED"
  heading: string;
  intro?: string;
  table?: { head: string[]; rows: string[][] };
  strip?: { label: string; value: string }[];
  note?: string;
  button?: { label: string; url: string };
  footer?: string;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const COLORS: Record<Band, { bg: string; fg: string }> = {
  blue: { bg: "#1F3864", fg: "#FFFFFF" },
  amber: { bg: "#B45309", fg: "#FFFFFF" },
  red: { bg: "#B91C1C", fg: "#FFFFFF" },
  green: { bg: "#15803D", fg: "#FFFFFF" },
  grey: { bg: "#475569", fg: "#FFFFFF" },
};

export const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const FOOTER = "Automated message from the XB Peak Shift Tracker. Please do not reply to this email.";

export function render(subject: string, s: EmailSpec): Rendered {
  const c = COLORS[s.band];
  const tableHtml = s.table
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr>${s.table.head
          .map((h) => `<th align="left" style="padding:8px 10px;background:#F1F5F9;border-bottom:1px solid #CBD5E1;color:#334155;font-weight:600;">${esc(h)}</th>`)
          .join("")}</tr>
        ${s.table.rows
          .map((r) => `<tr>${r.map((v) => `<td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;color:#0F172A;">${esc(v)}</td>`).join("")}</tr>`)
          .join("")}
      </table>`
    : "";
  const stripHtml = s.strip
    ? `<table role="presentation" width="100%" cellspacing="8" cellpadding="0" style="margin:12px 0;"><tr>${s.strip
        .map(
          (x) => `<td align="center" style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:12px 6px;">
            <div style="font-size:12px;color:#475569;">${esc(x.label)}</div>
            <div style="font-size:28px;font-weight:700;color:#0F172A;line-height:1.2;">${esc(x.value)}</div></td>`,
        )
        .join("")}</tr></table>`
    : "";
  const buttonHtml = s.button
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px 0;"><tr><td style="background:${c.bg};border-radius:8px;">
        <a href="${esc(s.button.url)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;">${esc(s.button.label)}</a>
      </td></tr></table>
      <div style="font-size:12px;color:#64748B;word-break:break-all;">If the button does not work, open: ${esc(s.button.url)}</div>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#E2E8F0;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#E2E8F0;"><tr><td align="center" style="padding:16px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFFFF;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
    <tr><td style="background:${c.bg};color:${c.fg};padding:12px 20px;font-size:13px;font-weight:700;letter-spacing:.06em;">${esc(s.tag)}</td></tr>
    <tr><td style="padding:20px;">
      <div style="font-size:20px;font-weight:700;color:#0F172A;line-height:1.3;">${esc(s.heading)}</div>
      ${s.intro ? `<div style="font-size:14px;color:#334155;margin-top:8px;line-height:1.5;">${esc(s.intro)}</div>` : ""}
      ${stripHtml}${tableHtml}
      ${s.note ? `<div style="font-size:14px;color:#334155;line-height:1.5;white-space:pre-line;">${esc(s.note)}</div>` : ""}
      ${buttonHtml}
    </td></tr>
    <tr><td style="padding:12px 20px;background:#F8FAFC;font-size:12px;color:#64748B;line-height:1.5;">${esc(s.footer ?? FOOTER)}</td></tr>
  </table>
</td></tr></table></body></html>`;

  const lines: string[] = [`[${s.tag}]`, s.heading];
  if (s.intro) lines.push("", s.intro);
  if (s.strip) lines.push("", s.strip.map((x) => `${x.label}: ${x.value}`).join("   "));
  if (s.table) {
    lines.push("", s.table.head.join(" | "));
    for (const r of s.table.rows) lines.push(r.join(" | "));
  }
  if (s.note) lines.push("", s.note);
  if (s.button) lines.push("", `${s.button.label}: ${s.button.url}`);
  lines.push("", s.footer ?? FOOTER);
  return { subject, html, text: lines.join("\n") };
}

// ---------------------------------------------------------------- shared shapes
export interface RoundInfo {
  hub: string;
  zone: string;
  label: string; // "08:00-16:00"
  opensAt: Date;
  cutoffAt: Date;
}

const subjectFor = (prefix: string, items: RoundInfo[]) =>
  items.length === 1
    ? `${prefix} - ${items[0].hub} ${items[0].label}`
    : `${prefix} - ${items.length} shifts (${items[0].hub}${items.length > 1 ? ` +${items.length - 1} more` : ""})`;

const roundRows = (items: RoundInfo[], off: number) =>
  items.map((i) => [i.hub, i.label, `by ${fmtDateTime(i.cutoffAt, off).split(", ")[1]}`]);

// ---------------------------------------------------------------- the emails
export function openEmail(o: { name: string; items: RoundInfo[]; url: string; off: number }): Rendered {
  return render(
    subjectFor("ACTION: Enter manpower", o.items),
    {
      band: "blue",
      tag: "ACTION NEEDED  |  MANPOWER ENTRY",
      heading: o.items.length === 1 ? `Enter manpower for ${o.items[0].hub}` : `Enter manpower for ${o.items.length} shifts`,
      intro: `Hi ${o.name}, the shift below started 30 minutes ago. Please enter the Planned and Actual Manpower - Hub Processing.`,
      table: { head: ["Hub", "Shift", "Enter"], rows: roundRows(o.items, o.off) },
      button: { label: "Enter manpower", url: o.url },
      note: "Takes about 30 seconds. You can forward this email to your shift in-charge; the link works for them too.",
    },
  );
}

export function reminderEmail(o: { name: string; items: RoundInfo[]; url: string; off: number; since: Date }): Rendered {
  return render(subjectFor("REMINDER: Manpower not entered", o.items), {
    band: "amber",
    tag: "REMINDER  |  NOT ENTERED",
    heading: `Still pending since ${fmtDateTime(o.since, o.off).split(", ")[1]}`,
    intro: `Hi ${o.name}, no manpower has been entered for the shift(s) below.`,
    table: { head: ["Hub", "Shift", "Enter"], rows: roundRows(o.items, o.off) },
    button: { label: "Enter manpower now", url: o.url },
  });
}

export function escalationEmail(o: { name: string; items: RoundInfo[]; url: string; off: number; notified: string }): Rendered {
  return render(subjectFor("ESCALATION: No manpower entry", o.items), {
    band: "red",
    tag: "ESCALATION  |  NO ENTRY",
    heading: "No manpower entry has been made",
    intro: `Hi ${o.name}, ${o.notified} were reminded an hour ago, and there is still no entry for the shift(s) below. Please enter it, or ask the shift in-charge to.`,
    table: { head: ["Hub", "Shift", "Enter"], rows: roundRows(o.items, o.off) },
    button: { label: "Enter manpower", url: o.url },
  });
}

export function overdueNoticeEmail(o: { name: string; rows: { hub: string; zone: string; label: string; pocs: string }[]; dashboardUrl: string }): Rendered {
  return render(`OVERDUE: ${o.rows.length} shift${o.rows.length === 1 ? "" : "s"} with no manpower entry`, {
    band: "red",
    tag: "OVERDUE  |  FOR YOUR ATTENTION",
    heading: `${o.rows.length} shift${o.rows.length === 1 ? " has" : "s have"} no manpower entry after 2 hours`,
    intro: `Hi ${o.name}, the POCs were emailed and reminded. These are still pending.`,
    table: { head: ["Hub", "Zone", "Shift", "POCs"], rows: o.rows.map((r) => [r.hub, r.zone, r.label, r.pocs]) },
    button: { label: "Open dashboard", url: o.dashboardUrl },
  });
}

export interface AlertInfo {
  hub: string;
  zone: string;
  label: string;
  planned: number;
  actual: number;
  need: number; // planned - actual
  enteredBy: string;
  enteredAt: Date;
  off: number;
}

export function lowAlertEmail(o: { name: string; a: AlertInfo; ackUrl?: string; dashboardUrl: string }): Rendered {
  const a = o.a;
  return render(`LOW MANPOWER: ${a.hub} ${a.label} short by ${a.need}`, {
    band: "red",
    tag: "LOW MANPOWER  |  CRITICAL",
    heading: `${a.hub} (${a.zone}) is short by ${a.need}`,
    intro: `Hi ${o.name}, ${a.enteredBy} reported this at ${fmtDateTime(a.enteredAt, a.off)} for the ${a.label} shift.`,
    strip: [
      { label: "Planned", value: String(a.planned) },
      { label: "Actual", value: String(a.actual) },
      { label: "Short by", value: String(a.need) },
    ],
    note: o.ackUrl ? "Please acknowledge and tell us the action or ETA for reinforcement." : undefined,
    button: o.ackUrl ? { label: "Acknowledge and give ETA", url: o.ackUrl } : { label: "Open dashboard", url: o.dashboardUrl },
  });
}

export function excessAlertEmail(o: { name: string; a: AlertInfo; dashboardUrl: string }): Rendered {
  const a = o.a;
  const over = -a.need;
  return render(`EXCESS MANPOWER: ${a.hub} ${a.label} +${over} above plan`, {
    band: "amber",
    tag: "EXCESS MANPOWER  |  BUFFER",
    heading: `${a.hub} (${a.zone}) has ${over} more than planned`,
    intro: `Hi ${o.name}, ${a.enteredBy} reported this at ${fmtDateTime(a.enteredAt, a.off)} for the ${a.label} shift. Consider redeploying or releasing the buffer.`,
    strip: [
      { label: "Planned", value: String(a.planned) },
      { label: "Actual", value: String(a.actual) },
      { label: "Above plan", value: String(over) },
    ],
    button: { label: "Open dashboard", url: o.dashboardUrl },
  });
}

export function resolvedEmail(o: { name: string; a: AlertInfo; was: "LOW" | "EXCESS"; dashboardUrl: string }): Rendered {
  const a = o.a;
  return render(`UPDATE: ${a.hub} ${a.label} is back within limits`, {
    band: "green",
    tag: "UPDATE  |  RESOLVED",
    heading: `${a.hub} is no longer ${o.was === "LOW" ? "short" : "in excess"}`,
    intro: `Hi ${o.name}, the figures were corrected by ${a.enteredBy}.`,
    strip: [
      { label: "Planned", value: String(a.planned) },
      { label: "Actual", value: String(a.actual) },
      { label: "Ad-hoc needed", value: String(a.need) },
    ],
    button: { label: "Open dashboard", url: o.dashboardUrl },
  });
}

export function ackReminderEmail(o: { name: string; a: AlertInfo; ackUrl: string }): Rendered {
  const a = o.a;
  return render(`REMINDER: Acknowledge LOW MANPOWER ${a.hub} ${a.label}`, {
    band: "red",
    tag: "ACKNOWLEDGEMENT PENDING",
    heading: `${a.hub} is short by ${a.need} and nobody has acknowledged`,
    intro: `Hi ${o.name}, please acknowledge and give the action or ETA.`,
    strip: [
      { label: "Planned", value: String(a.planned) },
      { label: "Actual", value: String(a.actual) },
      { label: "Short by", value: String(a.need) },
    ],
    button: { label: "Acknowledge and give ETA", url: o.ackUrl },
  });
}

export function unackNoticeEmail(o: { name: string; a: AlertInfo; hrName: string; dashboardUrl: string }): Rendered {
  const a = o.a;
  return render(`UNACKNOWLEDGED: LOW MANPOWER ${a.hub} ${a.label}`, {
    band: "red",
    tag: "UNACKNOWLEDGED  |  ESCALATION",
    heading: `${a.hub} short by ${a.need}: ${o.hrName} has not acknowledged`,
    intro: `Hi ${o.name}, the low-manpower alert has not been acknowledged within the allowed time.`,
    strip: [
      { label: "Planned", value: String(a.planned) },
      { label: "Actual", value: String(a.actual) },
      { label: "Short by", value: String(a.need) },
    ],
    button: { label: "Open dashboard", url: o.dashboardUrl },
  });
}

export interface DigestZone {
  zone: string;
  submitted: number;
  late: number;
  missed: number;
  total: number;
  low: { hub: string; label: string; need: number }[];
  excess: { hub: string; label: string; over: number }[];
  unacked: { hub: string; label: string; need: number }[];
  missedList: { hub: string; label: string }[];
}

export function digestEmail(o: { name: string; date: string; zones: DigestZone[]; dashboardUrl: string }): Rendered {
  const tot = o.zones.reduce((a, z) => ({ total: a.total + z.total, missed: a.missed + z.missed, low: a.low + z.low.length, excess: a.excess + z.excess.length }), { total: 0, missed: 0, low: 0, excess: 0 });
  const rows: string[][] = [];
  for (const z of o.zones) {
    rows.push([z.zone, `${z.submitted + z.late}/${z.total}`, String(z.missed), String(z.low.length), String(z.excess.length), String(z.unacked.length)]);
  }
  const detail: string[] = [];
  for (const z of o.zones) {
    for (const m of z.missedList) detail.push(`MISSED - ${z.zone}: ${m.hub} ${m.label}`);
    for (const l of z.low) detail.push(`LOW - ${z.zone}: ${l.hub} ${l.label} short by ${l.need}`);
    for (const e of z.excess) detail.push(`EXCESS - ${z.zone}: ${e.hub} ${e.label} +${e.over}`);
  }
  return render(`Daily manpower digest - ${o.date}`, {
    band: "grey",
    tag: "DAILY DIGEST",
    heading: `${o.date}: ${tot.total} shifts, ${tot.missed} missed, ${tot.low} low, ${tot.excess} excess`,
    intro: `Hi ${o.name}, here is yesterday's summary.`,
    table: { head: ["Zone", "Entered", "Missed", "Low", "Excess", "Unack'd"], rows },
    note: detail.length ? detail.slice(0, 40).join("\n") + (detail.length > 40 ? `\n...and ${detail.length - 40} more on the dashboard` : "") : "No exceptions.",
    button: { label: "Open dashboard", url: o.dashboardUrl },
  });
}

export function loginCodeEmail(o: { code: string }): Rendered {
  return render(`Your Peak Shift Tracker login code: ${o.code}`, {
    band: "blue",
    tag: "LOGIN CODE",
    heading: `Your login code is ${o.code}`,
    intro: "Enter this code on the login page. It expires in 10 minutes. If you did not ask for it, ignore this email.",
  });
}

export function systemNoticeEmail(o: { subject: string; heading: string; body: string }): Rendered {
  return render(o.subject, { band: "red", tag: "SYSTEM NOTICE", heading: o.heading, intro: o.body });
}
