// Admin operations behind the POC Directory and settings pages. Callers must already have
// checked that the visitor is a SYSTEM_ADMIN.
import { isAllowedEmail, loadConfig } from "./config";
import { audit, db, must } from "./db";

export interface PersonInput {
  name: string;
  email: string;
}

type Result = { ok: true; message?: string } | { ok: false; error: string };

const clean = (p: PersonInput) => ({ name: (p.name ?? "").trim(), email: (p.email ?? "").trim().toLowerCase() });

async function validate(p: PersonInput): Promise<string | null> {
  const cfg = await loadConfig();
  const c = clean(p);
  if (!c.name) return "Name is required.";
  if (c.name.length > 100) return "Name is too long.";
  if (!isAllowedEmail(c.email, cfg)) return `Email must end in ${cfg.allowedDomains.map((d) => "@" + d).join(" or ")}.`;
  return null;
}

/** Find a person by email, creating them if new. The name is refreshed if it changed. */
export async function upsertPerson(p: PersonInput): Promise<string> {
  const c = clean(p);
  const found = await db().from("people").select("id,name").eq("email", c.email).maybeSingle();
  if (found.data) {
    if (found.data.name !== c.name) await db().from("people").update({ name: c.name }).eq("id", found.data.id);
    return found.data.id;
  }
  return (must(await db().from("people").insert({ name: c.name, email: c.email }).select("id").single(), "create person") as { id: string }).id;
}

const SLOT_COL = { 1: "poc1_id", 2: "poc2_id", 3: "poc3_id" } as const;

/** Set POC1/2/3 of one hub. */
export async function setHubPocs(actor: string, hubId: string, pocs: PersonInput[]): Promise<Result> {
  if (pocs.length !== 3) return { ok: false, error: "Three POCs are required." };
  for (const p of pocs) {
    const err = await validate(p);
    if (err) return { ok: false, error: err };
  }
  const hub = await db().from("hubs").select("name,poc1_id,poc2_id,poc3_id").eq("id", hubId).maybeSingle();
  if (!hub.data) return { ok: false, error: "Unknown hub." };
  const ids = [await upsertPerson(pocs[0]), await upsertPerson(pocs[1]), await upsertPerson(pocs[2])];
  const upd = await db().from("hubs").update({ poc1_id: ids[0], poc2_id: ids[1], poc3_id: ids[2] }).eq("id", hubId);
  if (upd.error) return { ok: false, error: upd.error.message };
  await audit(actor, "poc_set", { hub: hub.data.name, old: [hub.data.poc1_id, hub.data.poc2_id, hub.data.poc3_id], new: ids, emails: pocs.map((p) => clean(p).email) });
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

/** Replace one person with another in POC slots: on every hub, one zone, or selected hubs. */
export async function replacePerson(actor: string, r: ReplaceInput): Promise<Result> {
  const err = await validate(r.to);
  if (err) return { ok: false, error: err };
  const fromEmail = r.fromEmail.trim().toLowerCase();
  const from = await db().from("people").select("id,name").eq("email", fromEmail).maybeSingle();
  if (!from.data) return { ok: false, error: "The person to replace was not found." };

  let q = db().from("hubs").select("id,name,poc1_id,poc2_id,poc3_id");
  if (r.scope === "zone") {
    if (!r.zoneId) return { ok: false, error: "Choose a zone." };
    q = q.eq("zone_id", r.zoneId);
  } else if (r.scope === "hubs") {
    if (!r.hubIds?.length) return { ok: false, error: "Select at least one hub." };
    q = q.in("id", r.hubIds);
  }
  const hubs = must(await q, "load hubs") as { id: string; name: string; poc1_id: string; poc2_id: string; poc3_id: string }[];
  const slots = r.slots?.length ? r.slots : ([1, 2, 3] as const);
  const toId = await upsertPerson(r.to);

  let changedHubs = 0;
  let changedSlots = 0;
  for (const h of hubs) {
    const patch: Record<string, string> = {};
    for (const s of slots) {
      const col = SLOT_COL[s];
      if ((h as unknown as Record<string, string>)[col] === from.data.id) {
        patch[col] = toId;
        changedSlots++;
      }
    }
    if (Object.keys(patch).length) {
      const u = await db().from("hubs").update(patch).eq("id", h.id);
      if (u.error) return { ok: false, error: u.error.message };
      changedHubs++;
    }
  }
  await audit(actor, "poc_replace", { from: fromEmail, to: clean(r.to).email, scope: r.scope, hubs: changedHubs, slots: changedSlots });
  return { ok: true, message: `Replaced ${fromEmail} with ${clean(r.to).email} in ${changedSlots} slot(s) across ${changedHubs} hub(s).` };
}

/** Same POC set on many hubs at once. */
export async function bulkAssign(actor: string, hubIds: string[], pocs: PersonInput[]): Promise<Result> {
  if (!hubIds.length) return { ok: false, error: "Select at least one hub." };
  let n = 0;
  for (const id of hubIds) {
    const r = await setHubPocs(actor, id, pocs);
    if (!r.ok) return r;
    n++;
  }
  return { ok: true, message: `Updated ${n} hub(s).` };
}

export async function setZoneContacts(actor: string, zoneId: string, rm: PersonInput, hr: PersonInput): Promise<Result> {
  for (const p of [rm, hr]) {
    const err = await validate(p);
    if (err) return { ok: false, error: err };
  }
  const upd = await db().from("zones").update({ rm_person_id: await upsertPerson(rm), hr_person_id: await upsertPerson(hr) }).eq("id", zoneId);
  if (upd.error) return { ok: false, error: upd.error.message };
  await audit(actor, "zone_contacts_set", { zoneId, rm: clean(rm).email, hr: clean(hr).email });
  return { ok: true, message: "Zone contacts saved." };
}

export async function setHubActive(actor: string, hubId: string, active: boolean): Promise<Result> {
  const upd = await db().from("hubs").update({ active }).eq("id", hubId);
  if (upd.error) return { ok: false, error: upd.error.message };
  await audit(actor, "hub_active", { hubId, active });
  return { ok: true };
}

export async function setGlobalContact(actor: string, role: "OPS_HEAD" | "SYSTEM_ADMIN", p: PersonInput, remove: boolean): Promise<Result> {
  const err = await validate(p);
  if (err) return { ok: false, error: err };
  const id = await upsertPerson(p);
  if (remove) {
    if (role === "SYSTEM_ADMIN") {
      const n = await db().from("global_contacts").select("id", { count: "exact", head: true }).eq("role", "SYSTEM_ADMIN");
      if ((n.count ?? 0) <= 1) return { ok: false, error: "There must always be at least one SYSTEM_ADMIN." };
    }
    await db().from("global_contacts").delete().eq("role", role).eq("person_id", id);
  } else {
    await db().from("global_contacts").upsert({ role, person_id: id }, { onConflict: "role,person_id" });
  }
  await audit(actor, remove ? "global_remove" : "global_add", { role, email: clean(p).email });
  return { ok: true };
}

/** Skip a date for a whole hub (no rounds are opened that day). */
export async function addSkipDate(actor: string, hubId: string, date: string, reason: string): Promise<Result> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Pick a valid date." };
  const ins = await db().from("skip_dates").insert({ hub_id: hubId, skip_date: date, reason: reason.slice(0, 200) || null });
  if (ins.error) return { ok: false, error: ins.error.message };
  await audit(actor, "skip_date_add", { hubId, date });
  return { ok: true };
}
