import { classify, type ManpowerClass } from "./classify";
import type { Config } from "./config";
import { db, must, mustOk } from "./db";
import { ackReminderEmail, excessAlertEmail, lowAlertEmail, resolvedEmail, unackNoticeEmail, type AlertInfo } from "./emails";
import { recipientsFor, type Hub, type Master } from "./master";
import { ackUrl, createLink, dashboardUrl, enqueue, isQueued } from "./notify";
import { addMinutes } from "./time";

export interface AlertContext {
  cfg: Config; // already resolved for this hub (per-hub overrides applied)
  master: Master;
  hub: Hub;
  roundId: string;
  label: string;
  cutoffAt: Date;
  planned: number;
  actual: number;
  enteredBy: string;
  enteredAt: Date;
}

interface AlertRow {
  id: string;
  class: "LOW" | "EXCESS";
  ack_required: boolean;
  adhoc_needed: number;
  acked_at: string | null;
}

/** A round that keeps flipping LOW <-> OK sends at most this many alerts in this many hours; the rest stay on the dashboard. */
const FLAP_MAX = 4;
const FLAP_WINDOW_H = 6;

const info = (c: AlertContext): AlertInfo => ({
  hub: c.hub.name,
  zone: c.hub.zone.name,
  label: c.label,
  planned: c.planned,
  actual: c.actual,
  need: c.planned - c.actual,
  enteredBy: c.enteredBy,
  enteredAt: c.enteredAt,
  off: c.cfg.tzOff,
});

const rolesFor = (cfg: Config, cls: "LOW" | "EXCESS") => (cls === "LOW" ? cfg.alertRecipientsLow : cfg.alertRecipientsExcess);

/** Links stay valid until the later of the cut-off and now, plus the grace period (a late edit must not get an already-expired link). */
const linkExpiry = (cfg: Config, cutoffAt: Date) => addMinutes(new Date(Math.max(cutoffAt.getTime(), Date.now())), cfg.tokenTtlHoursAfterCutoff * 60);

async function alertsRaisedRecently(roundId: string): Promise<number> {
  const since = new Date(Date.now() - FLAP_WINDOW_H * 3600_000).toISOString();
  const rows = must(await db().from("alerts").select("id").eq("round_id", roundId).gte("created_at", since), "count recent alerts") as unknown[];
  return rows.length;
}

/**
 * Make sure every recipient of an open alert has been emailed. Safe to run again and again:
 * an email that already exists is not queued twice. This is what recovers an alert whose emails
 * were lost to a crash or a database hiccup. When the numbers of an open LOW alert changed,
 * people who were already told get a short "updated numbers" email.
 */
async function queueAlertEmails(a: { alertId: string; cls: "LOW" | "EXCESS"; ackRequired: boolean; acked: boolean; update: boolean }, c: AlertContext) {
  const ai = info(c);
  for (const p of recipientsFor(rolesFor(c.cfg, a.cls), c.hub, c.master)) {
    const email = p.email.toLowerCase();
    const baseKey = `alert:${a.alertId}:${email}`;
    const isHr = a.cls === "LOW" && a.ackRequired && !a.acked && email === c.hub.zone.hr.email.toLowerCase();
    const alreadyTold = await isQueued(baseKey);
    if (alreadyTold && !(a.update && a.cls === "LOW")) continue;

    let url: string | undefined;
    if (isHr) {
      const link = await createLink({ kind: "ack", personId: p.id, roundIds: [c.roundId], alertId: a.alertId, expiresAt: linkExpiry(c.cfg, c.cutoffAt) });
      url = ackUrl(c.cfg, link.token);
    }
    if (a.cls === "LOW") {
      const m = lowAlertEmail({ name: p.name, a: ai, ackUrl: url, dashboardUrl: dashboardUrl(c.cfg), update: alreadyTold });
      await enqueue({
        ...m, dedupeKey: alreadyTold ? `alert:${a.alertId}:upd${ai.need}:${email}` : baseKey,
        kind: "low_alert", roundId: c.roundId, toName: p.name, toEmail: p.email,
      });
    } else {
      const m = excessAlertEmail({ name: p.name, a: ai, dashboardUrl: dashboardUrl(c.cfg) });
      await enqueue({ ...m, dedupeKey: baseKey, kind: "excess_alert", roundId: c.roundId, toName: p.name, toEmail: p.email });
    }
  }
}

/**
 * Bring the alert state of a round in line with its latest numbers.
 *  - same class as the open alert: keep the stored numbers current, make sure everyone was told,
 *    and send an "updated numbers" email if a LOW alert's shortfall changed
 *  - class changed (or back to OK): the old alert is closed and its recipients are told it is over;
 *    a new alert is raised if the new class needs one
 */
export async function applyAlert(c: AlertContext): Promise<ManpowerClass> {
  const cls = classify(c.planned, c.actual, c.cfg.thresholds);
  const d = db();
  const need = c.planned - c.actual;
  const open = (
    must(await d.from("alerts").select("id,class,ack_required,adhoc_needed,acked_at").eq("round_id", c.roundId).is("resolved_at", null), "load alert") as AlertRow[]
  )[0];

  if (open && open.class === cls) {
    const changed = open.adhoc_needed !== need;
    if (changed) mustOk(await d.from("alerts").update({ adhoc_needed: need }).eq("id", open.id), "update alert");
    await queueAlertEmails({ alertId: open.id, cls, ackRequired: open.ack_required, acked: Boolean(open.acked_at), update: changed }, c);
    return cls;
  }

  if (open) {
    mustOk(await d.from("alerts").update({ resolved_at: new Date().toISOString() }).eq("id", open.id), "close alert");
    const flapping = (await alertsRaisedRecently(c.roundId)) >= FLAP_MAX;
    if (!flapping) {
      // whoever was told about the old alert is told it is over, whether it went back to OK or flipped to another class
      for (const p of recipientsFor(rolesFor(c.cfg, open.class), c.hub, c.master)) {
        const r = resolvedEmail({ name: p.name, a: info(c), was: open.class, dashboardUrl: dashboardUrl(c.cfg) });
        await enqueue({ ...r, dedupeKey: `resolved:${open.id}:${p.email.toLowerCase()}`, kind: "resolved", roundId: c.roundId, toName: p.name, toEmail: p.email });
      }
    }
  }
  if (cls === "OK") return cls;

  const ackRequired = cls === "LOW" && c.cfg.ackRequiredLow;
  const ins = await d.from("alerts").insert({ round_id: c.roundId, class: cls, adhoc_needed: need, ack_required: ackRequired }).select("id").single();
  if (ins.error) {
    // a concurrent request already raised the alert for this round: it is handling the emails
    if (ins.error.code === "23505") return cls;
    throw new Error(`create alert: ${ins.error.message}`);
  }
  const alertId = (ins.data as { id: string }).id;
  const flapping = (await alertsRaisedRecently(c.roundId)) > FLAP_MAX;
  if (!flapping) await queueAlertEmails({ alertId, cls, ackRequired, acked: false, update: false }, c);
  return cls;
}

/**
 * Chase LOW alerts that nobody has acknowledged: re-send to the Zone HR and tell the Ops head
 * and Zone RM. Done at most twice per alert.
 */
export async function chaseUnacknowledged(
  now: Date,
  ctxFor: (roundId: string) => Promise<AlertContext | null>,
): Promise<number> {
  const d = db();
  const rows = must(
    await d
      .from("alerts")
      .select("id,round_id,repeat_count,last_sent_at")
      .eq("class", "LOW")
      .eq("ack_required", true)
      .is("acked_at", null)
      .is("resolved_at", null)
      .lt("repeat_count", 2),
    "load unacked alerts",
  ) as { id: string; round_id: string; repeat_count: number; last_sent_at: string }[];

  let chased = 0;
  for (const a of rows) {
    const c = await ctxFor(a.round_id);
    if (!c) continue;
    const due = new Date(a.last_sent_at).getTime() + c.cfg.ackWindowMin * 60000;
    if (now.getTime() < due) continue;
    const n = a.repeat_count + 1;
    const hr = c.hub.zone.hr;
    const link = await createLink({ kind: "ack", personId: hr.id, roundIds: [c.roundId], alertId: a.id, expiresAt: linkExpiry(c.cfg, c.cutoffAt) });
    const ai = info(c);
    const rem = ackReminderEmail({ name: hr.name, a: ai, ackUrl: ackUrl(c.cfg, link.token) });
    await enqueue({ ...rem, dedupeKey: `ackrem:${a.id}:${n}:${hr.email.toLowerCase()}`, kind: "ack_reminder", roundId: c.roundId, toName: hr.name, toEmail: hr.email });
    for (const p of recipientsFor(["OPS_HEAD", "ZONE_RM"], c.hub, c.master)) {
      const u = unackNoticeEmail({ name: p.name, a: ai, hrName: hr.name, dashboardUrl: dashboardUrl(c.cfg) });
      await enqueue({ ...u, dedupeKey: `unack:${a.id}:${n}:${p.email.toLowerCase()}`, kind: "unack", roundId: c.roundId, toName: p.name, toEmail: p.email });
    }
    mustOk(await d.from("alerts").update({ repeat_count: n, last_sent_at: now.toISOString() }).eq("id", a.id), "record chase");
    chased++;
  }
  return chased;
}
