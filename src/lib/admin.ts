// Admin operations behind the POC Directory and settings pages. Callers must already have
// checked that the visitor is a SYSTEM_ADMIN. Every write is checked: a failure is reported, never hidden.
import { invalidateCaches } from "./cache";
import { isAllowedEmail, loadConfig } from "./config";
import { audit, db, must, mustOk } from "./db";
import { UUID_RE } from "./auth";
import { isDateStr } from "./time";

export interface PersonInput {
  name: string;
  email: string;
}

type Result = { ok: true; message?: string } | { ok: false; error: string };

const clean = (p: PersonInput) => ({ name: String(p?.name ?? "").trim(), email: String(p?.email ?? "").trim().toLowerCase() });

async function validate(p: PersonInput): Promise<string | null> {
  const cfg = await loadConfig(true);
  const c = clean(p);
  if (!c.name) return "Name is required.";
  if (c.name.length > 100 || /[\r\n<>]/.test(c.name)) return "That name has characters that are not allowed.";
  if (!isAllowedEmail(c.email, cfg)) return `Email must end in ${cfg.allowedDomains.map((d) => "@" + d).join(" or ")}.`;
  return null;
}

/** Find a person by email, creating them if new. The name is refreshed if it changed. */
export async function upsertPerson(p: PersonInput): Promise<string> {
  const c = clean(p);
  const found = await db().from("people").select("id,name").eq("email", c.email).maybeSingle();
  mustOk(found, "find person");
  if (found.data) {
    if (found.data.name !== c.name) mustOk(await db().from("people").update({ name: c.name }).eq("id", found.data.id), "update person");
    return found.data.id;
  }
  const ins = await db().from("people").insert({ name: c.name, email: c.email }).select("id").single();
  if (ins.error) {
    // two requests created the same person at the same moment: use the one that won
    if (ins.error.code === "23505") {
      const again = await db().from("people").select("id").eq("email", c.email).single();
      return must(again, "find person").id as string;
    }
    throw new Error(`create person: ${ins.error.message}`);
  }
  return (ins.data as { id: string }).id;
}

const SLOT_COL = { 1: "poc1_id", 2: "poc2_id", 3: "poc3_id" } as const;

/**
 * Take back the emailed links of people who no longer cover these hubs, so a replaced or offboarded
 * POC cannot keep entering numbers with an old email. Links made from theirs (delegates) go too.
 */
export async function revokeLinksFor(personIds: string[], hubIds: string[]): Promise<number> {
  if (!personIds.length || !hubIds.length) return 0;
  const shifts = must(await db().from("hub_shifts").select("id").in("hub_id", hubIds), "load shifts") as { id: string }[];
  if (!shifts.length) return 0;
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const rounds = must(await db().from("rounds").select("id").in("hub_shift_id", shifts.map((s) => s.id)).gte("cutoff_at", since), "load rounds") as { id: string }[];
  if (!rounds.length) return 0;
  const hit = must(
    await db().from("link_tokens").update({ revoked: true }).in("person_id", personIds).eq("revoked", false).overlaps("round_ids", rounds.map((r) => r.id)).select("id"),
    "revoke links",
  ) as { id: string }[];
  if (hit.length) mustOk(await db().from("link_tokens").update({ revoked: true }).in("parent_token_id", hit.map((t) => t.id)), "revoke shared links");
  return hit.length;
}

/** Set POC1/2/3 of one hub. */
export async function setHubPocs(actor: string, hubId: string, pocs: PersonInput[]): Promise<Result> {
  if (!UUID_RE.test(hubId)) return { ok: false, error: "Unknown hub." };
  if (pocs.length !== 3) return { ok: false, error: "Three POCs are required." };
  for (const p of pocs) {
    const err = await validate(p);
    if (err) return { ok: false, error: err };
  }
  const hub = await db().from("hubs").select("name,poc1_id,poc2_id,poc3_id").eq("id", hubId).maybeSingle();
  mustOk(hub, "load hub");
  if (!hub.data) return { ok: false, error: "Unknown hub." };
  const ids = [await upsertPerson(pocs[0]), await upsertPerson(pocs[1]), await upsertPerson(pocs[2])];
  mustOk(await db().from("hubs").update({ poc1_id: ids[0], poc2_id: ids[1], poc3_id: ids[2] }).eq("id", hubId), "save POCs");
  invalidateCaches();
  const removed = [hub.data.poc1_id, hub.data.poc2_id, hub.data.poc3_id].filter((id) => !ids.includes(id));
  const revoked = await revokeLinksFor([...new Set(removed)], [hubId]);
  await audit(actor, "poc_set", { hub: hub.data.name, old: [hub.data.poc1_id, hub.data.poc2_id, hub.data.poc3_id], new: ids, emails: pocs.map((p) => clean(p).email), revokedLinks: revoked });
  return { ok: true, message: `Saved POCs for ${hub.data.name}.` };
}

export interface ReplaceInput {
  fromEmail: string;
  to: PersonInput;
  scope: "all" | "zone" | "hubs";
  zoneId?: string;
  hubIds?: string[];
  slots?: (1 | 2 | 3)[];
}

/** Replace one person with another in POC slots: on every hub, one zone, or selected hubs. At most 3 database updates. */
export async function replacePerson(actor: string, r: ReplaceInput): Promise<Result> {
  const err = await validate(r.to);
  if (err) return { ok: false, error: err };
  const fromEmail = String(r.fromEmail ?? "").trim().toLowerCase();
  const from = await db().from("people").select("id,name").eq("email", fromEmail).maybeSingle();
  mustOk(from, "find person");
  if (!from.data) return { ok: false, error: "The person to replace was not found." };
  if (r.scope === "zone" && !(typeof r.zoneId === "string" && UUID_RE.test(r.zoneId))) return { ok: false, error: "Choose a zone." };
  if (r.scope === "hubs" && !(Array.isArray(r.hubIds) && r.hubIds.length && r.hubIds.every((h) => typeof h === "string" && UUID_RE.test(h)))) return { ok: false, error: "Select at least one hub." };

  const slots = (r.slots?.length ? r.slots : [1, 2, 3]).filter((s): s is 1 | 2 | 3 => s === 1 || s === 2 || s === 3);
  const toId = await upsertPerson(r.to);
  const changed = new Set<string>();
  let changedSlots = 0;
  for (const s of slots) {
    const col = SLOT_COL[s];
    let q = db().from("hubs").update({ [col]: toId }).eq(col, from.data.id);
    if (r.scope === "zone") q = q.eq("zone_id", r.zoneId as string);
    else if (r.scope === "hubs") q = q.in("id", r.hubIds as string[]);
    const hit = must(await q.select("id"), `replace in POC${s}`) as { id: string }[];
    hit.forEach((h) => changed.add(h.id));
    changedSlots += hit.length;
  }
  invalidateCaches();
  const revoked = toId === from.data.id ? 0 : await revokeLinksFor([from.data.id], [...changed]);
  await audit(actor, "poc_replace", { from: fromEmail, to: clean(r.to).email, scope: r.scope, hubs: changed.size, slots: changedSlots, revokedLinks: revoked });
  return { ok: true, message: `Replaced ${fromEmail} with ${clean(r.to).email} in ${changedSlots} slot(s) across ${changed.size} hub(s).` };
}

/** Same POC set on many hubs at once: one update for all of them. */
export async function bulkAssign(actor: string, hubIds: string[], pocs: PersonInput[]): Promise<Result> {
  if (!hubIds.length || !hubIds.every((h) => UUID_RE.test(h))) return { ok: false, error: "Select at least one hub." };
  if (pocs.length !== 3) return { ok: false, error: "Three POCs are required." };
  for (const p of pocs) {
    const err = await validate(p);
    if (err) return { ok: false, error: err };
  }
  const before = must(await db().from("hubs").select("id,poc1_id,poc2_id,poc3_id").in("id", hubIds), "load hubs") as { id: string; poc1_id: string; poc2_id: string; poc3_id: string }[];
  const ids = [await upsertPerson(pocs[0]), await upsertPerson(pocs[1]), await upsertPerson(pocs[2])];
  mustOk(await db().from("hubs").update({ poc1_id: ids[0], poc2_id: ids[1], poc3_id: ids[2] }).in("id", hubIds), "save POCs");
  invalidateCaches();
  const gone = [...new Set(before.flatMap((h) => [h.poc1_id, h.poc2_id, h.poc3_id]).filter((id) => !ids.includes(id)))];
  const revoked = await revokeLinksFor(gone, hubIds);
  await audit(actor, "poc_bulk_set", { hubs: hubIds.length, emails: pocs.map((p) => clean(p).email), revokedLinks: revoked });
  return { ok: true, message: `Updated ${hubIds.length} hub(s).` };
}

export async function setZoneContacts(actor: string, zoneId: string, rm: PersonInput, hr: PersonInput): Promise<Result> {
  if (!UUID_RE.test(zoneId)) return { ok: false, error: "Unknown zone." };
  for (const p of [rm, hr]) {
    const err = await validate(p);
    if (err) return { ok: false, error: err };
  }
  mustOk(await db().from("zones").update({ rm_person_id: await upsertPerson(rm), hr_person_id: await upsertPerson(hr) }).eq("id", zoneId), "save zone contacts");
  invalidateCaches();
  await audit(actor, "zone_contacts_set", { zoneId, rm: clean(rm).email, hr: clean(hr).email });
  return { ok: true, message: "Zone contacts saved." };
}

export async function setHubActive(actor: string, hubId: string, active: boolean): Promise<Result> {
  if (!UUID_RE.test(hubId)) return { ok: false, error: "Unknown hub." };
  mustOk(await db().from("hubs").update({ active }).eq("id", hubId), "save hub");
  invalidateCaches();
  await audit(actor, "hub_active", { hubId, active });
  return { ok: true };
}

export async function setGlobalContact(actor: string, role: "OPS_HEAD" | "SYSTEM_ADMIN", p: PersonInput, remove: boolean): Promise<Result> {
  if (role !== "OPS_HEAD" && role !== "SYSTEM_ADMIN") return { ok: false, error: "Unknown role." };
  const err = await validate(p);
  if (err) return { ok: false, error: err };
  const id = await upsertPerson(p);
  if (remove) {
    if (role === "SYSTEM_ADMIN") {
      const n = await db().from("global_contacts").select("id", { count: "exact", head: true }).eq("role", "SYSTEM_ADMIN");
      mustOk(n, "count admins");
      if ((n.count ?? 0) <= 1) return { ok: false, error: "There must always be at least one SYSTEM_ADMIN." };
    }
    mustOk(await db().from("global_contacts").delete().eq("role", role).eq("person_id", id), "remove contact");
  } else {
    mustOk(await db().from("global_contacts").upsert({ role, person_id: id }, { onConflict: "role,person_id" }), "add contact");
  }
  invalidateCaches();
  await audit(actor, remove ? "global_remove" : "global_add", { role, email: clean(p).email });
  return { ok: true };
}

/** Skip a date for a whole hub (no rounds are opened that day). */
export async function addSkipDate(actor: string, hubId: string, date: string, reason: string): Promise<Result> {
  if (!UUID_RE.test(hubId)) return { ok: false, error: "Unknown hub." };
  if (!isDateStr(date)) return { ok: false, error: "Pick a valid date." };
  mustOk(await db().from("skip_dates").insert({ hub_id: hubId, skip_date: date, reason: reason.slice(0, 200) || null }), "save skip date");
  invalidateCaches();
  await audit(actor, "skip_date_add", { hubId, date });
  return { ok: true };
}

/** Give emails that failed (for example during a Gmail outage) another chance. Only recent ones: old reminders are stale. */
export async function requeueFailedEmails(actor: string): Promise<Result> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = must(
    await db().from("outbox").update({ status: "pending", attempts: 0, send_after: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
      .eq("status", "failed").gte("created_at", since).not("last_error", "like", "expired%").select("id"),
    "requeue emails",
  ) as { id: string }[];
  await audit(actor, "outbox_requeue", { count: rows.length });
  return { ok: true, message: `${rows.length} email(s) will be sent again within a minute.` };
}
