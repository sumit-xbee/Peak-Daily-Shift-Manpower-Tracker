// The scheduler. Called every minute (pg_cron -> /api/tick). Everything here is idempotent:
// calling it twice, or two overlapping calls, never double-sends.
import { chaseUnacknowledged } from "./alerts";
import { buildConfig, configForHub, loadOverrides, loadRawConfig, type Config } from "./config";
import { chunk, db, selectAll } from "./db";
import { digestEmail, escalationEmail, openEmail, overdueNoticeEmail, reminderEmail, systemNoticeEmail, type DigestZone, type RoundInfo } from "./emails";
import { isSkipped, loadMaster, recipientsFor, type Master, type Person } from "./master";
import { createLink, dashboardUrl, enqueue, entryUrl, groupId, notifyAdmins } from "./notify";
import { processOutbox, yesterdayOf, type OutboxResult } from "./outbox";
import { buildViews, loadEntrySummaries, loadRoundsByIds, loadRoundsForDates, type RoundView } from "./rounds";
import { computeRoundTimes, dueSteps, timesFromRound, type Step } from "./schedule";
import { addDays, addMinutes, localDateStr, localHM } from "./time";

export interface TickResult {
  paused: boolean;
  roundsCreated: number;
  notificationsQueued: number;
  alertsChased: number;
  digestQueued: number;
  outbox: OutboxResult | null;
  at: string;
}

type Overrides = Map<string, Record<string, unknown>>;

export async function runTick(now = new Date()): Promise<TickResult> {
  const raw = await loadRawConfig();
  const cfg = buildConfig(raw);
  const result: TickResult = { paused: false, roundsCreated: 0, notificationsQueued: 0, alertsChased: 0, digestQueued: 0, outbox: null, at: now.toISOString() };

  await db().from("heartbeat").upsert({ id: 1, last_tick: now.toISOString(), info: { enabled: cfg.systemEnabled, dryRun: cfg.dryRun } });
  if (!cfg.systemEnabled) {
    result.paused = true;
    return result;
  }

  const master = await loadMaster();
  const overrides = await loadOverrides();

  result.roundsCreated = await ensureRounds(master, cfg, raw, overrides, now);
  const dates = windowDates(cfg, now);
  const rounds = await loadRoundsForDates(dates);
  const entries = await loadEntrySummaries(rounds.map((r) => r.id));
  const views = buildViews(rounds, entries, master, cfg, raw, overrides, now);

  result.notificationsQueued = await notifyRounds(views, master, cfg, now);
  result.alertsChased = await chaseUnacknowledged(now, async (roundId) => {
    const v = views.find((x) => x.round.id === roundId) ?? (await viewForRound(roundId, master, cfg, raw, overrides, now));
    if (!v || !v.entry) return null;
    return {
      cfg: v.cfg, master, hub: v.shift.hub, roundId, label: v.label, cutoffAt: v.times.cutoffAt,
      planned: v.entry.latest.planned, actual: v.entry.latest.actual, enteredBy: v.entry.latest.entered_by_email, enteredAt: new Date(v.entry.latest.created_at),
    };
  });
  result.digestQueued = await maybeDigest(master, cfg, raw, overrides, now);

  result.outbox = await processOutbox(cfg, now);
  await adminWatch(master, cfg, now, result.outbox);
  return result;
}

const windowDates = (cfg: Config, now: Date) => {
  const today = localDateStr(now, cfg.tzOff);
  return [addDays(today, -1), today];
};

async function viewForRound(roundId: string, master: Master, cfg: Config, raw: Record<string, unknown>, overrides: Overrides, now: Date) {
  const rounds = await loadRoundsByIds([roundId]);
  const entries = await loadEntrySummaries([roundId]);
  return buildViews(rounds, entries, master, cfg, raw, overrides, now)[0] ?? null;
}

// ---------------------------------------------------------------- 1. create rounds
/** Create today's and yesterday's rounds as they open. Never reaches back before the system was (re)enabled. */
async function ensureRounds(master: Master, cfg: Config, raw: Record<string, unknown>, overrides: Overrides, now: Date): Promise<number> {
  const dates = windowDates(cfg, now);
  const existing = await selectAll<{ hub_shift_id: string; round_date: string }>("rounds", "hub_shift_id,round_date", (q) => q.in("round_date", dates));
  const have = new Set(existing.map((e) => `${e.hub_shift_id}|${e.round_date}`));
  const rows: Record<string, unknown>[] = [];

  for (const s of master.shifts.values()) {
    if (!s.active || !s.hub.active) continue;
    const hc = configForHub(cfg, raw, overrides, s.hub.id);
    for (const d of dates) {
      if (have.has(`${s.id}|${d}`) || isSkipped(master, s.hub.id, s.id, d)) continue;
      const t = computeRoundTimes(d, s.start, hc.offsets, hc.tzOff);
      if (t.opensAt.getTime() > now.getTime()) continue; // not yet
      if (cfg.enabledSince && t.opensAt.getTime() < cfg.enabledSince.getTime()) continue; // opened while the system was off
      rows.push({ hub_shift_id: s.id, round_date: d, shift_start: t.shiftStart.toISOString(), opens_at: t.opensAt.toISOString(), cutoff_at: t.cutoffAt.toISOString() });
    }
  }
  if (!rows.length) return 0;
  const { error } = await db().from("rounds").upsert(rows, { onConflict: "hub_shift_id,round_date", ignoreDuplicates: true });
  if (error) throw new Error(`create rounds: ${error.message}`);
  return rows.length;
}

// ---------------------------------------------------------------- 2. notifications
const info = (v: RoundView): RoundInfo => ({ hub: v.shift.hub.name, zone: v.shift.hub.zone.name, label: v.label, opensAt: v.times.opensAt, cutoffAt: v.times.cutoffAt });

interface Group {
  person: Person;
  views: RoundView[];
}

/** Collect, per person, the rounds they should be told about. One email per person per step per tick. */
function groupBy(views: RoundView[], roles: (v: RoundView) => string[], master: Master, skip?: (v: RoundView, p: Person) => boolean): Group[] {
  const map = new Map<string, Group>();
  for (const v of views) {
    for (const p of recipientsFor(roles(v), v.shift.hub, master)) {
      if (skip?.(v, p)) continue;
      const k = p.email.toLowerCase();
      const g = map.get(k) ?? { person: p, views: [] };
      g.views.push(v);
      map.set(k, g);
    }
  }
  return [...map.values()];
}

const expiryFor = (views: RoundView[], cfg: Config) => addMinutes(new Date(Math.max(...views.map((v) => v.times.cutoffAt.getTime()))), cfg.tokenTtlHoursAfterCutoff * 60);

async function notifyRounds(views: RoundView[], master: Master, cfg: Config, now: Date): Promise<number> {
  const open = views.filter((v) => v.times.opensAt.getTime() <= now.getTime());
  if (!open.length) return 0;

  const done = new Set<string>();
  for (const c of chunk(open.map((v) => v.round.id))) {
    const { data, error } = await db().from("round_steps").select("round_id,step").in("round_id", c);
    if (error) throw new Error(`load steps: ${error.message}`);
    for (const r of (data ?? []) as { round_id: string; step: string }[]) done.add(`${r.round_id}|${r.step}`);
  }

  const todo: Record<Step, RoundView[]> = { open: [], reminder: [], l3: [], rm_ops: [] };
  const marks: { round_id: string; step: string }[] = [];
  for (const v of open) {
    const hasEntry = Boolean(v.entry);
    const pastCutoff = now.getTime() >= v.times.cutoffAt.getTime();
    for (const step of dueSteps(now, timesFromRound(v.times.shiftStart, v.times.opensAt, v.times.cutoffAt, v.cfg.offsets), hasEntry)) {
      if (done.has(`${v.round.id}|${step}`)) continue;
      // a round that is already past cut-off with nothing sent is recorded, not emailed
      if (step === "open" && pastCutoff && !hasEntry) marks.push({ round_id: v.round.id, step });
      else if (step === "open" && hasEntry) marks.push({ round_id: v.round.id, step });
      else todo[step].push(v);
    }
  }

  let queued = 0;
  const off = cfg.tzOff;

  // open: POC1 + POC2 (config), one email per person listing their rounds
  for (const g of groupBy(todo.open, (v) => v.cfg.firstEmailTo, master)) {
    const ids = g.views.map((v) => v.round.id);
    const link = await createLink({ kind: "poc", personId: g.person.id, roundIds: ids, expiresAt: expiryFor(g.views, cfg) });
    const m = openEmail({ name: g.person.name, items: g.views.map(info), url: entryUrl(cfg, link.token), off });
    if (await enqueue({ ...m, dedupeKey: `open:${g.person.id}:${groupId(ids)}`, kind: "open", toName: g.person.name, toEmail: g.person.email })) queued++;
  }

  // reminder: the same people, still no entry
  for (const g of groupBy(todo.reminder, (v) => v.cfg.firstEmailTo, master)) {
    const ids = g.views.map((v) => v.round.id);
    const link = await createLink({ kind: "poc", personId: g.person.id, roundIds: ids, expiresAt: expiryFor(g.views, cfg) });
    const since = new Date(Math.min(...g.views.map((v) => v.times.opensAt.getTime())));
    const m = reminderEmail({ name: g.person.name, items: g.views.map(info), url: entryUrl(cfg, link.token), off, since });
    if (await enqueue({ ...m, dedupeKey: `reminder:${g.person.id}:${groupId(ids)}`, kind: "reminder", toName: g.person.name, toEmail: g.person.email })) queued++;
  }

  // l3: POC3, unless POC3 is the same person as POC1/POC2 (already reminded)
  const sameAsFirst = (v: RoundView, p: Person) =>
    recipientsFor(v.cfg.firstEmailTo, v.shift.hub, master).some((x) => x.email.toLowerCase() === p.email.toLowerCase());
  for (const g of groupBy(todo.l3, () => ["POC3"], master, sameAsFirst)) {
    const ids = g.views.map((v) => v.round.id);
    const link = await createLink({ kind: "poc", personId: g.person.id, roundIds: ids, expiresAt: expiryFor(g.views, cfg) });
    const notified = [...new Set(g.views.flatMap((v) => recipientsFor(v.cfg.firstEmailTo, v.shift.hub, master).map((p) => p.name)))].join(" and ");
    const m = escalationEmail({ name: g.person.name, items: g.views.map(info), url: entryUrl(cfg, link.token), off, notified });
    if (await enqueue({ ...m, dedupeKey: `l3:${g.person.id}:${groupId(ids)}`, kind: "l3", toName: g.person.name, toEmail: g.person.email })) queued++;
  }

  // rm_ops: Zone RM and Ops head see what is overdue
  for (const g of groupBy(todo.rm_ops, () => ["ZONE_RM", "OPS_HEAD"], master)) {
    const ids = g.views.map((v) => v.round.id);
    const rows = g.views.map((v) => ({ hub: v.shift.hub.name, zone: v.shift.hub.zone.name, label: v.label, pocs: [...new Set(v.shift.hub.pocs.map((p) => p.name))].join(", ") }));
    const m = overdueNoticeEmail({ name: g.person.name, rows, dashboardUrl: dashboardUrl(cfg) });
    if (await enqueue({ ...m, dedupeKey: `rm_ops:${g.person.id}:${groupId(ids)}`, kind: "rm_ops", toName: g.person.name, toEmail: g.person.email })) queued++;
  }

  for (const step of ["open", "reminder", "l3", "rm_ops"] as Step[]) for (const v of todo[step]) marks.push({ round_id: v.round.id, step });
  if (marks.length) {
    const { error } = await db().from("round_steps").upsert(marks, { onConflict: "round_id,step", ignoreDuplicates: true });
    if (error) throw new Error(`mark steps: ${error.message}`);
  }
  return queued;
}

// ---------------------------------------------------------------- 3. daily digest
async function maybeDigest(master: Master, cfg: Config, raw: Record<string, unknown>, overrides: Overrides, now: Date): Promise<number> {
  const [hh, mm] = cfg.digestTimeIst.split(":").map(Number);
  const [nh, nm] = localHM(now, cfg.tzOff).split(":").map(Number);
  if (nh * 60 + nm < hh * 60 + mm) return 0;

  const today = localDateStr(now, cfg.tzOff);
  const { data: already } = await db().from("outbox").select("id").like("dedupe_key", `digest:${today}:%`).limit(1);
  if (already && already.length) return 0;

  const date = yesterdayOf(cfg, now);
  const rounds = await loadRoundsForDates([date]);
  const entries = await loadEntrySummaries(rounds.map((r) => r.id));
  const views = buildViews(rounds, entries, master, cfg, raw, overrides, now);

  const alerts: { round_id: string; class: string; acked_at: string | null }[] = [];
  for (const c of chunk(rounds.map((r) => r.id))) {
    const { data } = await db().from("alerts").select("round_id,class,acked_at").in("round_id", c).eq("ack_required", true);
    alerts.push(...((data ?? []) as typeof alerts));
  }
  const unacked = new Set(alerts.filter((a) => a.class === "LOW" && !a.acked_at).map((a) => a.round_id));

  const zoneDigest = (zoneId: string): DigestZone | null => {
    const vs = views.filter((v) => v.shift.hub.zone.id === zoneId);
    if (!vs.length) return null;
    const z = vs[0].shift.hub.zone;
    return {
      zone: z.name,
      total: vs.length,
      submitted: vs.filter((v) => v.status === "SUBMITTED").length,
      late: vs.filter((v) => v.status === "LATE").length,
      missed: vs.filter((v) => v.status === "MISSED" || v.status === "OVERDUE").length,
      low: vs.filter((v) => v.cls === "LOW").map((v) => ({ hub: v.shift.hub.name, label: v.label, need: v.entry!.latest.adhoc_needed })),
      excess: vs.filter((v) => v.cls === "EXCESS").map((v) => ({ hub: v.shift.hub.name, label: v.label, over: -v.entry!.latest.adhoc_needed })),
      unacked: vs.filter((v) => unacked.has(v.round.id)).map((v) => ({ hub: v.shift.hub.name, label: v.label, need: v.entry!.latest.adhoc_needed })),
      missedList: vs.filter((v) => v.status === "MISSED" || v.status === "OVERDUE").map((v) => ({ hub: v.shift.hub.name, label: v.label })),
    };
  };

  const allZones = [...master.zones.values()].map((z) => zoneDigest(z.id)).filter((x): x is DigestZone => x !== null);
  if (!allZones.length) return 0; // nothing ran yesterday, so there is nothing to report

  let queued = 0;
  const base = dashboardUrl(cfg);
  for (const p of master.opsHeads) {
    const m = digestEmail({ name: p.name, date, zones: allZones, dashboardUrl: base });
    if (await enqueue({ ...m, dedupeKey: `digest:${today}:${p.email.toLowerCase()}`, kind: "digest", toName: p.name, toEmail: p.email })) queued++;
  }
  for (const z of master.zones.values()) {
    const zd = zoneDigest(z.id);
    if (!zd) continue;
    const m = digestEmail({ name: z.rm.name, date, zones: [zd], dashboardUrl: base });
    if (await enqueue({ ...m, dedupeKey: `digest:${today}:${z.rm.email.toLowerCase()}`, kind: "digest", toName: z.rm.name, toEmail: z.rm.email })) queued++;
  }
  return queued;
}

// ---------------------------------------------------------------- 4. watch the system itself
async function adminWatch(master: Master, cfg: Config, now: Date, out: OutboxResult) {
  const today = localDateStr(now, cfg.tzOff);
  if (out.sentToday >= (cfg.dailySendCap * cfg.capWarnPct) / 100) {
    const r = systemNoticeEmail({
      subject: `Email cap at ${Math.round((out.sentToday / cfg.dailySendCap) * 100)}% today`,
      heading: "Daily email cap is nearly used up",
      body: `${out.sentToday} of ${cfg.dailySendCap} emails were sent today. At the cap only LOW alerts are sent; everything else waits for tomorrow.`,
    });
    await notifyAdmins(master.admins, `capwarn:${today}`, r);
  }
  const { count } = await db().from("outbox").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", addMinutes(now, -60).toISOString());
  if ((count ?? 0) > 0) {
    const r = systemNoticeEmail({
      subject: `${count} email(s) failed to send`,
      heading: "Some emails could not be sent",
      body: `${count} email(s) failed after several attempts in the last hour. Check the Gmail app password and the Outbox on the dashboard.`,
    });
    await notifyAdmins(master.admins, `fail:${today}:${now.getUTCHours()}`, r);
  }
}
