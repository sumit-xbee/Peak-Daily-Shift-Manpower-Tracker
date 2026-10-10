import { bearerMatches, json } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { dashboardUrl } from "@/lib/notify";
import { sendMail } from "@/lib/mailer";
import { poc3ReportEmail } from "@/lib/emails";
import { emailRows, loadPoc3Reports } from "@/lib/poc3report";
import { addDays, isDateStr, localDateStr } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Preview of the morning POC3 report. Protected like the scheduler. It NEVER emails the real POC3:
 * each preview goes only to the dry-run address (or the sender's own mailbox).
 *   POST { "date": "2026-10-10", "limit": 2 }   (date defaults to yesterday)
 */
export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => ({}))) as { date?: string; limit?: number };
  const now = new Date();
  const cfg = await loadConfig(true);
  const date = body.date && isDateStr(body.date) ? body.date : addDays(localDateStr(now, cfg.tzOff), -1);
  const { reports } = await loadPoc3Reports(date, now);
  const to = cfg.dryRunTo || process.env.GMAIL_USER;
  if (!to) return json({ error: "no dry-run address and no sender mailbox" }, 400);

  const limit = Math.max(1, Math.min(10, Number(body.limit) || 2));
  const sent: { poc3: string; hubs: number; shifts: number; low: number; peopleShort: number }[] = [];
  for (const r of reports.slice(0, limit)) {
    const { rows, hidden } = emailRows(r.rows);
    const m = poc3ReportEmail({ name: r.person.name, date, hubCount: r.hubCount, totals: r.totals, rows, hiddenRows: hidden, dashboardUrl: dashboardUrl(cfg) });
    await sendMail({ to, subject: `[PREVIEW for ${r.person.name}] ${m.subject}`, html: m.html, text: m.text, fromName: cfg.senderDisplayName });
    sent.push({ poc3: r.person.name, hubs: r.hubCount, shifts: r.totals.shifts, low: r.totals.low, peopleShort: r.totals.peopleShort });
  }
  return json({ date, previewSentTo: to, poc3Count: reports.length, sent });
}
