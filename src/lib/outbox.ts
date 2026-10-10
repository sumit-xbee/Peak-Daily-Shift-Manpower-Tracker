import type { Config } from "./config";
import { db } from "./db";
import { mailerConfigured, sendMail } from "./mailer";
import { addDays, localDateStr, localToUtc } from "./time";

export interface OutboxResult {
  sent: number;
  failed: number;
  retried: number;
  held: number;
  sentToday: number;
  skippedNoMailer: boolean;
}

interface OutRow {
  id: string;
  kind: string;
  to_name: string | null;
  to_email: string;
  subject: string;
  html: string;
  text_body: string;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

/** Count emails sent since local midnight. */
export async function sentTodayCount(cfg: Config, now: Date): Promise<number> {
  const startOfDay = localToUtc(localDateStr(now, cfg.tzOff), "00:00", cfg.tzOff);
  const { count } = await db()
    .from("outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("sent_at", startOfDay.toISOString());
  return count ?? 0;
}

const backoffMin = (attempts: number) => Math.min(30, attempts * attempts);

/**
 * Send queued emails. Dry-run redirects every email to the admin address, so testing never
 * reaches real people. The daily cap holds back everything except LOW alerts.
 */
export async function processOutbox(cfg: Config, now: Date, limit = 25): Promise<OutboxResult> {
  const res: OutboxResult = { sent: 0, failed: 0, retried: 0, held: 0, sentToday: 0, skippedNoMailer: false };
  if (!mailerConfigured()) {
    res.skippedNoMailer = true;
    return res;
  }
  const { data, error } = await db().rpc("claim_outbox", { p_limit: limit });
  if (error) throw new Error(`claim_outbox: ${error.message}`);
  const rows = (data ?? []) as OutRow[];
  let sentToday = await sentTodayCount(cfg, now);
  res.sentToday = sentToday;

  for (const r of rows) {
    const release = async (patch: Record<string, unknown>) =>
      db().from("outbox").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", r.id);

    // cap: hold back everything but LOW alerts
    if (sentToday >= cfg.dailySendCap && r.kind !== "low_alert") {
      res.held++;
      await release({ status: "pending", attempts: Math.max(0, r.attempts - 1), send_after: new Date(now.getTime() + 30 * 60000).toISOString() });
      continue;
    }

    let to = r.to_email;
    let subject = r.subject;
    if (cfg.dryRun) {
      if (!cfg.dryRunTo) {
        await release({ status: "failed", last_error: "dry run is on but dry_run_to is empty" });
        res.failed++;
        continue;
      }
      to = cfg.dryRunTo;
      subject = `[DRY RUN for ${r.to_email}] ${r.subject}`;
    }

    try {
      await sendMail({ to, subject, html: r.html, text: r.text_body, fromName: cfg.senderDisplayName, replyTo: cfg.replyTo });
      await release({ status: "sent", sent_at: new Date().toISOString(), last_error: null });
      res.sent++;
      sentToday++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (r.attempts >= MAX_ATTEMPTS) {
        await release({ status: "failed", last_error: msg.slice(0, 500) });
        res.failed++;
      } else {
        await release({ status: "pending", last_error: msg.slice(0, 500), send_after: new Date(now.getTime() + backoffMin(r.attempts) * 60000).toISOString() });
        res.retried++;
      }
    }
  }
  res.sentToday = sentToday;
  return res;
}

export const yesterdayOf = (cfg: Config, now: Date) => addDays(localDateStr(now, cfg.tzOff), -1);
