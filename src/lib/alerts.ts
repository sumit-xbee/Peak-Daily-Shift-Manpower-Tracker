import { classify, type ManpowerClass } from "./classify";
import type { Config } from "./config";
import { db, must } from "./db";
import { ackReminderEmail, excessAlertEmail, lowAlertEmail, resolvedEmail, unackNoticeEmail, type AlertInfo } from "./emails";
import { recipientsFor, type Hub, type Master } from "./master";
import { ackUrl, createLink, dashboardUrl, enqueue } from "./notify";
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
}

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

/**
 * Bring the alert state of a round in line with its latest numbers.
 *  - same class as the open alert: nothing (no duplicate emails)
 *  - class changed: the old alert is closed and a new one raised
 *  - back to OK: the open alert is closed and the recipients are told
 */
export async function applyAlert(c: AlertContext): Promise<ManpowerClass> {
  const cls = classify(c.planned, c.actual, c.cfg.thresholds);
  const d = db();
  const open = (
    must(await d.from("alerts").select("id,class,ack_required").eq("round_id", c.roundId).is("resolved_at", null), "load alert") as AlertRow[]
  )[0];

  if (open && open.class === cls) return cls;

  if (open) {
    await d.from("alerts").update({ resolved_at: new Date().toISOString() }).eq("id", open.id);
    if (cls === "OK") {
      for (const p of recipientsFor(rolesFor(c.cfg, open.class), c.hub, c.master)) {
        const r = resolvedEmail({ name: p.name, a: info(c), was: open.class, dashboardUrl: dashboardUrl(c.cfg) });
        await enqueue({ ...r, dedupeKey: `resolved:${open.id}:${p.email.toLowerCase()}`, kind: "resolved", roundId: c.roundId, toName: p.name, toEmail: p.email });
      }
    }
  }
  if (cls === "OK") return cls;

  const ackRequired = cls === "LOW" && c.cfg.ackRequiredLow;
  const ins = await d
    .from("alerts")
    .insert({ round_id: c.roundId, class: cls, adhoc_needed: c.planned - c.actual, ack_required: ackRequired })
    .select("id")
    .single();
  if (ins.error) {
    // a concurrent request already raised the alert for this round
    if (ins.error.code === "23505") return cls;
    throw new Error(`create alert: ${ins.error.message}`);
  }
  const alertId = (ins.data as { id: string }).id;

  for (const p of recipientsFor(rolesFor(c.cfg, cls), c.hub, c.master)) {
    let r;
    if (cls === "LOW") {
      let url: string | undefined;
      if (ackRequired && p.email.toLowerCase() === c.hub.zone.hr.email.toLowerCase()) {
        const link = await createLink({ kind: "ack", personId: p.id, roundIds: [c.roundId], alertId, expiresAt: addMinutes(c.cutoffAt, c.cfg.tokenTtlHoursAfterCutoff * 60) });
        url = ackUrl(c.cfg, link.token);
      }
      r = lowAlertEmail({ name: p.name, a: info(c), ackUrl: url, dashboardUrl: dashboardUrl(c.cfg) });
    } else {
      r = excessAlertEmail({ name: p.name, a: info(c), dashboardUrl: dashboardUrl(c.cfg) });
    }
    await enqueue({ ...r, dedupeKey: `alert:${alertId}:${p.email.toLowerCase()}`, kind: cls === "LOW" ? "low_alert" : "excess_alert", roundId: c.roundId, toName: p.name, toEmail: p.email });
  }
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
    const link = await createLink({ kind: "ack", personId: hr.id, roundIds: [c.roundId], alertId: a.id, expiresAt: addMinutes(c.cutoffAt, c.cfg.tokenTtlHoursAfterCutoff * 60) });
    const ai = info(c);
    const rem = ackReminderEmail({ name: hr.name, a: ai, ackUrl: ackUrl(c.cfg, link.token) });
    await enqueue({ ...rem, dedupeKey: `ackrem:${a.id}:${n}:${hr.email.toLowerCase()}`, kind: "ack_reminder", roundId: c.roundId, toName: hr.name, toEmail: hr.email });
    for (const p of recipientsFor(["OPS_HEAD", "ZONE_RM"], c.hub, c.master)) {
      const u = unackNoticeEmail({ name: p.name, a: ai, hrName: hr.name, dashboardUrl: dashboardUrl(c.cfg) });
      await enqueue({ ...u, dedupeKey: `unack:${a.id}:${n}:${p.email.toLowerCase()}`, kind: "unack", roundId: c.roundId, toName: p.name, toEmail: p.email });
    }
    await d.from("alerts").update({ repeat_count: n, last_sent_at: now.toISOString() }).eq("id", a.id);
    chased++;
  }
  return chased;
}
