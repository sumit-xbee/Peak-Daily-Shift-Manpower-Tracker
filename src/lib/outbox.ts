import type { Config } from "./config";
import { db } from "./db";
import { mailerConfigured, sendMail } from "./mailer";
import { addDays, localDateStr, localToUtc } from "./time";

export interface OutboxResult {
  sent: number;
  failed: number;
  retried: number;
  held: number;
  expired: number;
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
  created_at: string;
}

interface Policy {
  /** an email older than this is no longer useful and is dropped, not sent */
  maxAgeMin: number;
  /** attempts before it is marked failed (an admin can re-queue it) */
  maxAttempts: number;
  /** longest wait between two attempts */
  backoffCapMin: number;
}

const HOUR = 60;
const POLICY: Record<string, Policy> = {
  // alerts must get through even if Gmail is down for hours
  low_alert: { maxAgeMin: 24 * HOUR, maxAttempts: 60, backoffCapMin: 30 },
  resolved: { maxAgeMin: 12 * HOUR, maxAttempts: 40, backoffCapMin: 30 },
  ack_reminder: { maxAgeMin: 12 * HOUR, maxAttempts: 40, backoffCapMin: 30 },
  unack: { maxAgeMin: 12 * HOUR, maxAttempts: 40, backoffCapMin: 30 },
  // a reminder or escalation about "no entry yet" goes stale quickly
  open: { maxAgeMin: 90, maxAttempts: 10, backoffCapMin: 10 },
  reminder: { maxAgeMin: 90, maxAttempts: 10, backoffCapMin: 10 },
  l3: { maxAgeMin: 90, maxAttempts: 10, backoffCapMin: 10 },
  rm_ops: { maxAgeMin: 90, maxAttempts: 10, backoffCapMin: 10 },
  digest: { maxAgeMin: 12 * HOUR, maxAttempts: 40, backoffCapMin: 30 },
  poc3_report: { maxAgeMin: 12 * HOUR, maxAttempts: 40, backoffCapMin: 30 },
  system: { maxAgeMin: 6 * HOUR, maxAttempts: 20, backoffCapMin: 30 },
};
const DEFAULT_POLICY: Policy = { maxAgeMin: 3 * HOUR, maxAttempts: 15, backoffCapMin: 20 };
export const policyFor = (kind: string): Policy => POLICY[kind] ?? DEFAULT_POLICY;

/** LOW alerts may go beyond the daily cap, but not beyond this many extra emails (Google's hard limit is ~2,000 a day). */
const LOW_ALERT_HEADROOM = 300;

/** Count emails sent since local midnight. Throws on a database error (a failure must not look like "0 sent", which would skip the cap). */
export async function sentTodayCount(cfg: Config, now: Date): Promise<number> {
  const startOfDay = localToUtc(localDateStr(now, cfg.tzOff), "00:00", cfg.tzOff);
  const { count, error } = await db()
    .from("outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("sent_at", startOfDay.toISOString());
  if (error) throw new Error(`count sent: ${error.message}`);
  return count ?? 0;
}

/**
 * Send queued emails. Dry-run redirects every email to the admin address, so testing never
 * reaches real people. The daily cap holds back everything except LOW alerts.
 * `deadlineMs` is the time by which sending must stop, so a slow mail server cannot run the scheduler out of time.
 */
export async function processOutbox(cfg: Config, now: Date, limit = 15, deadlineMs = Date.now() + 40_000): Promise<OutboxResult> {
  const res: OutboxResult = { sent: 0, failed: 0, retried: 0, held: 0, expired: 0, sentToday: 0, skippedNoMailer: false };
  if (!mailerConfigured()) {
    res.skippedNoMailer = true;
    return res;
  }
  const { data, error } = await db().rpc("claim_outbox", { p_limit: limit });
  if (error) throw new Error(`claim_outbox: ${error.message}`);
  const rows = (data ?? []) as OutRow[];
  if (!rows.length) return res;
  let sentToday = await sentTodayCount(cfg, now);
  res.sentToday = sentToday;

  const patchRow = async (id: string, patch: Record<string, unknown>) => {
    const { error: e } = await db().from("outbox").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    return e;
  };
  /** put a claimed row back without counting this as an attempt */
  const giveBack = (r: OutRow, waitMin: number) =>
    patchRow(r.id, { status: "pending", attempts: Math.max(0, r.attempts - 1), send_after: new Date(now.getTime() + waitMin * 60000).toISOString() });

  for (const r of rows) {
    const pol = policyFor(r.kind);

    // out of time: leave the rest for the next minute
    if (Date.now() > deadlineMs) {
      await giveBack(r, 0);
      continue;
    }
    // too old to be useful (e.g. a "please enter" reminder that was stuck behind an outage)
    if (now.getTime() - new Date(r.created_at).getTime() > pol.maxAgeMin * 60000) {
      await patchRow(r.id, { status: "failed", last_error: `expired: older than ${pol.maxAgeMin} minutes` });
      res.expired++;
      continue;
    }
    // a row that keeps being claimed again (a send that never finished) is not retried for ever
    if (r.attempts > pol.maxAttempts) {
      await patchRow(r.id, { status: "failed", last_error: "gave up after too many attempts" });
      res.failed++;
      continue;
    }
    // cap: hold back everything but LOW alerts, which may use a little headroom
    const limitFor = r.kind === "low_alert" ? cfg.dailySendCap + LOW_ALERT_HEADROOM : cfg.dailySendCap;
    if (sentToday >= limitFor) {
      res.held++;
      await giveBack(r, 30);
      continue;
    }

    let to = r.to_email;
    let subject = r.subject;
    if (cfg.dryRun) {
      if (!cfg.dryRunTo) {
        // dry run is on but there is nowhere to send test mail: wait, do not throw the email away
        res.held++;
        await giveBack(r, 5);
        continue;
      }
      to = cfg.dryRunTo;
      subject = `[DRY RUN for ${r.to_email}] ${r.subject}`;
    }

    try {
      await sendMail({ to, subject, html: r.html, text: r.text_body, fromName: cfg.senderDisplayName, replyTo: cfg.replyTo });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (r.attempts >= pol.maxAttempts) {
        await patchRow(r.id, { status: "failed", last_error: msg.slice(0, 500) });
        res.failed++;
      } else {
        const wait = Math.min(pol.backoffCapMin, Math.max(1, r.attempts * r.attempts));
        await patchRow(r.id, { status: "pending", last_error: msg.slice(0, 500), send_after: new Date(now.getTime() + wait * 60000).toISOString() });
        res.retried++;
      }
      continue;
    }
    // the email IS sent. Recording it must not be skipped: if this fails the row would be sent again.
    let recorded = false;
    for (let i = 0; i < 3 && !recorded; i++) {
      recorded = (await patchRow(r.id, { status: "sent", sent_at: new Date().toISOString(), last_error: null })) === null;
    }
    if (!recorded) console.error("sent an email but could not record it", r.id);
    res.sent++;
    sentToday++;
  }
  res.sentToday = sentToday;
  return res;
}

export const yesterdayOf = (cfg: Config, now: Date) => addDays(localDateStr(now, cfg.tzOff), -1);
