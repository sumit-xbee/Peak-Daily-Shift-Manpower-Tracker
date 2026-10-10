// The scheduler. Called every minute (pg_cron -> /api/tick). Everything here is idempotent:
// calling it twice, or two overlapping calls, never double-sends.
// Every stage runs on its own: if one fails, the others still run and the failure is reported
// (in the result, in the heartbeat the health check reads, and by email to the admins).
import { chaseUnacknowledged } from "./alerts";
import { buildConfig, configForHub, loadOverrides, loadRawConfig, type Config } from "./config";
import { chunk, db, mustOk, selectAll } from "./db";
import { digestEmail, escalationEmail, openEmail, overdueNoticeEmail, poc3ReportEmail, reminderEmail, systemNoticeEmail, type DigestZone, type RoundInfo } from "./emails";
import { isSkipped, loadMaster, recipientsFor, type Master, type Person } from "./master";
import { createLink, dashboardUrl, enqueue, entryUrl, groupId, isQueued, notifyAdmins } from "./notify";
import { processOutbox, yesterdayOf, type OutboxResult } from "./outbox";
import { emailRows, loadPoc3Reports } from "./poc3report";
import { buildViews, isLiveRound, loadEntrySummaries, loadEntrySummariesForDates, loadRoundsByIds, loadRoundsForDates, type RoundView } from "./rounds";
import { computeRoundTimes, dueSteps, timesFromRound, type Step } from "./schedule";
import { addDays, addMinutes, localDateStr, localHM } from "./time";

export interface TickResult {
  paused: boolean;
  roundsCreated: number;
  notificationsQueued: number;
  alertsChased: number;
  digestQueued: number;
  poc3ReportQueued: number;
  outbox: OutboxResult | null;
  errors: string[];
  at: string;
}

type Overrides = Map<string, Record<string, unknown>>;

/** The scheduler must finish well inside the 60 s Vercel allows; stages that are not urgent are skipped when time is short. */
const SOFT_BUDGET_MS = 30_000;
const HARD_BUDGET_MS = 50_000;

export async function runTick(now = new Date()): Promise<TickResult> {
  const started = Date.now();
  const raw = await loadRawConfig(true); // the scheduler never works from cached settings
  const cfg = buildConfig(raw);
  const result: TickResult = {
    paused: false, roundsCreated: 0, notificationsQueued: 0, alertsChased: 0, digestQueued: 0, poc3ReportQueued: 0, outbox: null, errors: [], at: now.toISOString(),
  };
  const guard = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      console.error(`tick stage failed: ${name}`, e);
      result.errors.push(`${name}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      return fallback;
    }
  };
  const beat = (info: Record<string, unknown>) => db().from("heartbeat").upsert({ id: 1, last_tick: new Date().toISOString(), info });

  if (!cfg.systemEnabled) {
    result.paused = true;
    await guard("heartbeat", async () => mustOk(await beat({ enabled: false, dryRun: cfg.dryRun }), "heartbeat"), undefined);
    return result;
  }

  const loaded = await guard("load master data", async () => {
    const [master, overrides] = await Promise.all([loadMaster(true), loadOverrides(true)]);
    return { master, overrides };
  }, null);

  if (loaded) {
    const { master, overrides } = loaded;
    result.roundsCreated = await guard("create rounds", () => ensureRounds(master, cfg, raw, overrides, now), 0);

    const views = await guard("load rounds", async () => {
      const dates = windowDates(cfg, now);
      const [rounds, entries] = await Promise.all([loadRoundsForDates(dates), loadEntrySummariesForDates(dates)]);
      return buildViews(rounds, entries, master, cfg, raw, overrides, now);
    }, null);

    if (views) {
      result.notificationsQueued = await guard("queue emails", () => notifyRounds(views, master, cfg, now), 0);
      result.alertsChased = await guard("chase unacknowledged alerts", () =>
        chaseUnacknowledged(now, async (roundId) => {
          const v = views.find((x) => x.round.id === roundId) ?? (await viewForRound(roundId, master, cfg, raw, overrides, now));
          if (!v || !v.entry) return null;
          return {
            cfg: v.cfg, master, hub: v.shift.hub, roundId, label: v.label, cutoffAt: v.times.cutoffAt,
            planned: v.entry.latest.planned, actual: v.entry.latest.actual, enteredBy: v.entry.latest.entered_by_email, enteredAt: new Date(v.entry.latest.created_at),
          };
        }), 0);
    }
    // the morning reports are not urgent: skip them this minute if earlier stages ran long
    if (Date.now() - started < SOFT_BUDGET_MS) {
      result.digestQueued = await guard("daily digest", () => maybeDigest(master, cfg, raw, overrides, now), 0);
      result.poc3ReportQueued = await guard("POC3 morning report", () => maybePoc3Report(cfg, raw, now), 0);
    }
  }

  // Sending always runs, whatever failed above: alerts already queued by a user's save must go out.
  result.outbox = await guard("send emails", () => processOutbox(cfg, now, 15, started + HARD_BUDGET_MS), null);
  if (loaded && result.outbox) {
    const out = result.outbox;
    await guard("admin watch", () => adminWatch(loaded.master, cfg, now, out, result.errors), undefined);
  }
  // The heartbeat is written LAST and carries this run's errors, so the health check turns red when a run goes wrong.
  await guard("heartbeat", async () => mustOk(await beat({ enabled: true, dryRun: cfg.dryRun, errors: result.errors, ms: Date.now() - started }), "heartbeat"), undefined);
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
/**
 * Create rounds as they open. A round is only created within `round_create_grace_min` (default 60) of its
 * opening, and never for a shift that opened before the system was (re)enabled. That means a shift or hub added
 * or switched back on later does not suddenly get yesterday's rounds (which would show up as false "missed").
 */
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
      if (now.getTime() - t.opensAt.getTime() > cfg.roundCreateGraceMin * 60000) continue; // too long ago to start now
      if (cfg.enabledSince && t.opensAt.getTime() < cfg.enabledSince.getTime()) continue; // opened while the system was off
      rows.push({ hub_shift_id: s.id, round_date: d, shift_start: t.shiftStart.toISOString(), opens_at: t.opensAt.toISOString(), cutoff_at: t.cutoffAt.toISOString() });
    }
  }
  if (!rows.length) return 0;
  mustOk(await db().from("rounds").upsert(rows, { onConflict: "hub_shift_id,round_date", ignoreDuplicates: true }), "create rounds");
  return rows.length;
}

// ---------------------------------------------------------------- 2. notifications
const info = (v: RoundView): RoundInfo => ({ hub: v.shift.hub.name, zone: v.shift.hub.zone.name, label: v.label, opensAt: v.times.opensAt, cutoffAt: v.times.cutoffAt });

interface Group {
  person: Person;
  views: RoundView[];
}

/**
 * Collect, per person AND per shift start time, the rounds they should be told about.
 * A person is never sent one email that mixes different start times, and never hears about a
 * hub they are not a recipient for. Hubs that start at the same time are merged into one email.
 */
export function groupBy(views: RoundView[], roles: (v: RoundView) => string[], master: Master, skip?: (v: RoundView, p: Person) => boolean): Group[] {
  const map = new Map<string, Group>();
  for (const v of views) {
    for (const p of recipientsFor(roles(v), v.shift.hub, master)) {
      if (skip?.(v, p)) continue;
      const k = `${p.email.toLowerCase()}|${v.times.shiftStart.getTime()}`;
      const g = map.get(k) ?? { person: p, views: [] };
      g.views.push(v);
      map.set(k, g);
    }
  }
  return [...map.values()];
}

const expiryFor = (views: RoundView[], cfg: Config) => addMinutes(new Date(Math.max(...views.map((v) => v.times.cutoffAt.getTime()))), cfg.tokenTtlHoursAfterCutoff * 60);

async function notifyRounds(allViews: RoundView[], master: Master, cfg: Config, now: Date): Promise<number> {
  // shifts switched off (or dates skipped) after the round was created get no reminders or escalations
  const open = allViews.filter((v) => v.times.opensAt.getTime() <= now.getTime() && isLiveRound(v, master));
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

  // For each group the email's key is worked out FIRST; if it is already queued (a retry after a crash)
  // no new link is created, so a retry never piles up unused links.

  // open: POC1 + POC2 (config), one email per person listing their rounds
  for (const g of groupBy(todo.open, (v) => v.cfg.firstEmailTo, master)) {
    const ids = g.views.map((v) => v.round.id);
    const key = `open:${g.person.id}:${groupId(ids)}`;
    if (await isQueued(key)) continue;
    const link = await createLink({ kind: "poc", personId: g.person.id, roundIds: ids, expiresAt: expiryFor(g.views, cfg) });
    const m = openEmail({ name: g.person.name, items: g.views.map(info), url: entryUrl(cfg, link.token), off });
    if (await enqueue({ ...m, dedupeKey: key, kind: "open", toName: g.person.name, toEmail: g.person.email })) queued++;
  }

  // reminder: the same people, still no entry
  for (const g of groupBy(todo.reminder, (v) => v.cfg.firstEmailTo, master)) {
    const ids = g.views.map((v) => v.round.id);
    const key = `reminder:${g.person.id}:${groupId(ids)}`;
    if (await isQueued(key)) continue;
    const link = await createLink({ kind: "poc", personId: g.person.id, roundIds: ids, expiresAt: expiryFor(g.views, cfg) });
    const since = new Date(Math.min(...g.views.map((v) => v.times.opensAt.getTime())));
    const m = reminderEmail({ name: g.person.name, items: g.views.map(info), url: entryUrl(cfg, link.token), off, since });
    if (await enqueue({ ...m, dedupeKey: key, kind: "reminder", toName: g.person.name, toEmail: g.person.email })) queued++;
  }

  // l3: POC3, unless POC3 is the same person as POC1/POC2 (already reminded)
  const sameAsFirst = (v: RoundView, p: Person) =>
    recipientsFor(v.cfg.firstEmailTo, v.shift.hub, master).some((x) => x.email.toLowerCase() === p.email.toLowerCase());
  for (const g of groupBy(todo.l3, () => ["POC3"], master, sameAsFirst)) {
    const ids = g.views.map((v) => v.round.id);
    const key = `l3:${g.person.id}:${groupId(ids)}`;
    if (await isQueued(key)) continue;
    const link = await createLink({ kind: "poc", personId: g.person.id, roundIds: ids, expiresAt: expiryFor(g.views, cfg) });
    const notified = [...new Set(g.views.flatMap((v) => recipientsFor(v.cfg.firstEmailTo, v.shift.hub, master).map((p) => p.name)))].join(" and ");
    const m = escalationEmail({ name: g.person.name, items: g.views.map(info), url: entryUrl(cfg, link.token), off, notified });
    if (await enqueue({ ...m, dedupeKey: key, kind: "l3", toName: g.person.name, toEmail: g.person.email })) queued++;
  }

  // rm_ops: Zone RM and Ops head see what is overdue
  for (const g of groupBy(todo.rm_ops, () => ["ZONE_RM", "OPS_HEAD"], master)) {
    const ids = g.views.map((v) => v.round.id);
    const rows = g.views.map((v) => ({ hub: v.shift.hub.name, zone: v.shift.hub.zone.name, label: v.label, pocs: [...new Set(v.shift.hub.pocs.map((p) => p.name))].join(", ") }));
    const m = overdueNoticeEmail({ name: g.person.name, rows, dashboardUrl: dashboardUrl(cfg) });
    if (await enqueue({ ...m, dedupeKey: `rm_ops:${g.person.id}:${groupId(ids)}`, kind: "rm_ops", toName: g.person.name, toEmail: g.person.email })) queued++;
  }

  for (const step of ["open", "reminder", "l3", "rm_ops"] as Step[]) for (const v of todo[step]) marks.push({ round_id: v.round.id, step });
  if (marks.length) mustOk(await db().from("round_steps").upsert(marks, { onConflict: "round_id,step", ignoreDuplicates: true }), "mark steps");
  return queued;
}

// ---------------------------------------------------------------- 3. daily digest
/**
 * 07:00 IST (setting): yesterday's summary to the Ops head (all zones) and to each Zone RM (their zones, combined
 * if one person is RM of several). Sent once a day; each recipient has their own dedupe key, and the day is
 * marked done only after every email has been queued, so a failure half-way is simply picked up next minute.
 */
async function maybeDigest(master: Master, cfg: Config, raw: Record<string, unknown>, overrides: Overrides, now: Date): Promise<number> {
  const [hh, mm] = cfg.digestTimeIst.split(":").map(Number);
  const [nh, nm] = localHM(now, cfg.tzOff).split(":").map(Number);
  if (nh * 60 + nm < hh * 60 + mm) return 0;

  const today = localDateStr(now, cfg.tzOff);
  if (raw.digest_last_date === today) return 0;

  const date = yesterdayOf(cfg, now);
  const [rounds, entries] = await Promise.all([loadRoundsForDates([date]), loadEntrySummariesForDates([date])]);
  const views = buildViews(rounds, entries, master, cfg, raw, overrides, now).filter((v) => isLiveRound(v, master));

  // open (not resolved) LOW alerts that nobody acknowledged
  const roundIds = new Set(rounds.map((r) => r.id));
  const { data, error } = await db().from("alerts").select("round_id,class,acked_at,rounds!inner(round_date)").eq("ack_required", true).is("resolved_at", null).eq("rounds.round_date", date);
  if (error) throw new Error(`load alerts for digest: ${error.message}`);
  const unacked = new Set(((data ?? []) as unknown as { round_id: string; class: string; acked_at: string | null }[]).filter((a) => a.class === "LOW" && !a.acked_at && roundIds.has(a.round_id)).map((a) => a.round_id));

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
  let queued = 0;
  if (allZones.length) {
    const base = dashboardUrl(cfg);
    for (const p of master.opsHeads) {
      const m = digestEmail({ name: p.name, date, zones: allZones, dashboardUrl: base });
      if (await enqueue({ ...m, dedupeKey: `digest:${today}:${p.email.toLowerCase()}`, kind: "digest", toName: p.name, toEmail: p.email })) queued++;
    }
    // one digest per Zone RM, covering every zone they look after
    const byRm = new Map<string, { person: Person; zones: DigestZone[] }>();
    for (const z of master.zones.values()) {
      const zd = zoneDigest(z.id);
      if (!zd) continue;
      const k = z.rm.email.toLowerCase();
      const cur = byRm.get(k) ?? { person: z.rm, zones: [] };
      cur.zones.push(zd);
      byRm.set(k, cur);
    }
    for (const [email, g] of byRm) {
      const m = digestEmail({ name: g.person.name, date, zones: g.zones, dashboardUrl: base });
      if (await enqueue({ ...m, dedupeKey: `digest:${today}:${email}`, kind: "digest", toName: g.person.name, toEmail: g.person.email })) queued++;
    }
  }
  // mark the day done (also when there was nothing to report, so this is not recomputed every minute)
  mustOk(await db().from("app_config").upsert({ key: "digest_last_date", value: today, updated_at: now.toISOString(), updated_by: "scheduler" }), "mark digest done");
  return queued;
}

// ---------------------------------------------------------------- 3b. 6 AM report to POC3 (regional managers)
/**
 * Every morning at `poc3_report_time_ist` (default 06:00 IST): each POC3 gets yesterday's shifts for
 * the hubs under them, ranked by gap % against plan, with ad-hoc (LOW) shifts highlighted.
 * Sent once per day; if the system was off at 06:00 it goes out as soon as it is back on.
 */
async function maybePoc3Report(cfg: Config, raw: Record<string, unknown>, now: Date): Promise<number> {
  if (!cfg.poc3ReportEnabled) return 0;
  const [hh, mm] = cfg.poc3ReportTimeIst.split(":").map(Number);
  const [nh, nm] = localHM(now, cfg.tzOff).split(":").map(Number);
  if (nh * 60 + nm < hh * 60 + mm) return 0;

  const today = localDateStr(now, cfg.tzOff);
  if (raw.poc3_report_last_date === today) return 0; // already done today

  const date = addDays(today, -1);
  const { reports } = await loadPoc3Reports(date, now);
  let queued = 0;
  for (const r of reports) {
    const { rows, hidden } = emailRows(r.rows);
    const m = poc3ReportEmail({ name: r.person.name, date, hubCount: r.hubCount, totals: r.totals, rows, hiddenRows: hidden, dashboardUrl: dashboardUrl(cfg) });
    if (await enqueue({ ...m, dedupeKey: `poc3report:${today}:${r.person.email.toLowerCase()}`, kind: "poc3_report", toName: r.person.name, toEmail: r.person.email })) queued++;
  }
  mustOk(await db().from("app_config").upsert({ key: "poc3_report_last_date", value: today, updated_at: now.toISOString(), updated_by: "scheduler" }), "mark POC3 report done");
  return queued;
}

// ---------------------------------------------------------------- 4. watch the system itself
async function adminWatch(master: Master, cfg: Config, now: Date, out: OutboxResult, errors: string[]) {
  const today = localDateStr(now, cfg.tzOff);
  if (out.sentToday >= (cfg.dailySendCap * cfg.capWarnPct) / 100) {
    const r = systemNoticeEmail({
      subject: `Email cap at ${Math.round((out.sentToday / cfg.dailySendCap) * 100)}% today`,
      heading: "Daily email cap is nearly used up",
      body: `${out.sentToday} of ${cfg.dailySendCap} emails were sent today. At the cap only LOW alerts are sent; everything else waits for tomorrow.`,
    });
    await notifyAdmins(master.admins, `capwarn:${today}`, r);
  }
  const { count, error } = await db().from("outbox").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", addMinutes(now, -60).toISOString());
  if (error) throw new Error(`count failed emails: ${error.message}`);
  if ((count ?? 0) > 0) {
    const r = systemNoticeEmail({
      subject: `${count} email(s) failed to send`,
      heading: "Some emails could not be sent",
      body: `${count} email(s) failed in the last hour. Check the Gmail app password, then use "Re-send failed emails" on the Emails page.`,
    });
    await notifyAdmins(master.admins, `fail:${today}:${now.getUTCHours()}`, r);
  }
  if (errors.length > 0) {
    const r = systemNoticeEmail({
      subject: "The scheduler had errors",
      heading: "A scheduler step failed",
      body: `The scheduler kept running, but: ${errors.slice(0, 3).join(" | ")}. Emails already queued are still being sent.`,
    });
    await notifyAdmins(master.admins, `tickerr:${today}:${now.getUTCHours()}`, r);
  }
}
