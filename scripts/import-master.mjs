// Load the master-data Excel into Supabase.
//   npm run import:master                      (reads templates/master_data_template.xlsx)
//   npm run import:master -- path/to/file.xlsx
//   npm run import:master -- --prune           (also switch off shifts that are no longer in the sheet)
//   npm run import:master -- --check           (validate only, change nothing)
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local. Run it on your own computer:
// the Excel holds employee emails, so it is kept out of Git on purpose.
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const args = process.argv.slice(2);
const prune = args.includes("--prune");
const checkOnly = args.includes("--check");
const file = args.find((a) => !a.startsWith("--")) ?? "templates/master_data_template.xlsx";
const DOMAINS = ["xpressbees.com", "xpressbees.in"];

const errors = [];
const err = (sheet, row, msg) => errors.push(`${sheet} row ${row}: ${msg}`);

function cellText(c) {
  let v = c.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) v = v.result;
    else if ("richText" in v) v = v.richText.map((t) => t.text).join("");
    else if ("text" in v) v = v.text;
  }
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function cellTime(c) {
  let v = c.value;
  if (v && typeof v === "object" && !(v instanceof Date) && "result" in v) v = v.result;
  const pad = (n) => String(n).padStart(2, "0");
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:00`;
  if (typeof v === "number") {
    const mins = Math.round((v % 1) * 24 * 60);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}:00`;
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? "").trim());
  return m ? `${pad(Number(m[1]))}:${m[2]}:00` : null;
}

function readSheet(wb, name, headers) {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`Sheet "${name}" not found`);
  const out = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vals = headers.map((_, i) => row.getCell(i + 1));
    if (vals.every((c) => cellText(c) === "")) continue;
    out.push({ r, cells: vals });
  }
  return out;
}

const okEmail = (e) => {
  const x = e.toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(x) && x.split("@").length === 2 && DOMAINS.includes(x.split("@")[1]);
};

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);

// ---- parse
const people = new Map(); // email -> name
const addPerson = (sheet, r, name, email) => {
  if (!name) return err(sheet, r, "a name is missing");
  if (!okEmail(email)) return err(sheet, r, `"${email}" is not a valid @xpressbees.com / @xpressbees.in email`);
  const k = email.toLowerCase();
  people.set(k, name);
  return k;
};

const zones = readSheet(wb, "Zones", ["Zone", "RM", "RMe", "HR", "HRe"]).map(({ r, cells }) => {
  const [z, rm, rme, hr, hre] = cells.map(cellText);
  if (!z) err("Zones", r, "Zone is missing");
  return { name: z, rm: addPerson("Zones", r, rm, rme), hr: addPerson("Zones", r, hr, hre) };
});
const zoneNames = new Set(zones.map((z) => z.name));
if (zoneNames.size !== zones.length) errors.push("Zones: duplicate zone name");

const hubs = readSheet(wb, "Hubs", ["Hub", "Zone", "p1", "p1e", "p2", "p2e", "p3", "p3e", "Active"]).map(({ r, cells }) => {
  const t = cells.map(cellText);
  if (!t[0]) err("Hubs", r, "Hub is missing");
  if (!zoneNames.has(t[1])) err("Hubs", r, `Zone "${t[1]}" is not in the Zones sheet`);
  const act = t[8].toUpperCase();
  if (act !== "Y" && act !== "N") err("Hubs", r, "Active must be Y or N");
  return {
    name: t[0], zone: t[1],
    pocs: [addPerson("Hubs", r, t[2], t[3]), addPerson("Hubs", r, t[4], t[5]), addPerson("Hubs", r, t[6], t[7])],
    active: act === "Y",
  };
});
const hubNames = new Set(hubs.map((h) => h.name));
if (hubNames.size !== hubs.length) errors.push("Hubs: duplicate hub name");

const shifts = readSheet(wb, "Shifts", ["Hub", "Start", "End"]).map(({ r, cells }) => {
  const hub = cellText(cells[0]);
  const start = cellTime(cells[1]);
  const end = cellTime(cells[2]);
  if (!hubNames.has(hub)) err("Shifts", r, `Hub "${hub}" is not in the Hubs sheet`);
  if (!start || !end) err("Shifts", r, "Shift Start / End must be times like 08:00");
  if (start && start === end) err("Shifts", r, "Start and End cannot be the same");
  return { hub, start, end };
});

const globals = readSheet(wb, "Global Contacts", ["Role", "Name", "Email"]).map(({ r, cells }) => {
  const [role, name, email] = cells.map(cellText);
  if (role !== "OPS_HEAD" && role !== "SYSTEM_ADMIN") err("Global Contacts", r, "Role must be OPS_HEAD or SYSTEM_ADMIN");
  return { role, email: addPerson("Global Contacts", r, name, email) };
});
if (!globals.some((g) => g.role === "OPS_HEAD")) errors.push("Global Contacts: needs one OPS_HEAD");
if (!globals.some((g) => g.role === "SYSTEM_ADMIN")) errors.push("Global Contacts: needs one SYSTEM_ADMIN");

console.log(`Read ${zones.length} zones, ${hubs.length} hubs, ${shifts.length} shift rows, ${globals.length} global contacts, ${people.size} distinct people.`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s) found. Nothing was changed:\n - ` + errors.join("\n - "));
  process.exit(1);
}
if (checkOnly) {
  console.log("Check passed. Nothing was changed (--check).");
  process.exit(0);
}

// ---- write
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const must = (res, what) => {
  if (res.error) {
    console.error(`${what}: ${res.error.message}`);
    process.exit(1);
  }
  return res.data;
};

// people: insert new, update names of existing
const existing = must(await db.from("people").select("id,email,name"), "read people");
const idByEmail = new Map(existing.map((p) => [p.email.toLowerCase(), p.id]));
const nameByEmail = new Map(existing.map((p) => [p.email.toLowerCase(), p.name]));
const fresh = [];
for (const [email, name] of people) {
  if (!idByEmail.has(email)) fresh.push({ email, name });
  else if (nameByEmail.get(email) !== name) must(await db.from("people").update({ name }).eq("id", idByEmail.get(email)), "update person");
}
if (fresh.length) for (const p of must(await db.from("people").insert(fresh).select("id,email"), "insert people")) idByEmail.set(p.email.toLowerCase(), p.id);

must(await db.from("zones").upsert(zones.map((z) => ({ name: z.name, rm_person_id: idByEmail.get(z.rm), hr_person_id: idByEmail.get(z.hr) })), { onConflict: "name" }), "upsert zones");
const zoneId = new Map(must(await db.from("zones").select("id,name"), "read zones").map((z) => [z.name, z.id]));

must(
  await db.from("hubs").upsert(
    hubs.map((h) => ({ name: h.name, zone_id: zoneId.get(h.zone), poc1_id: idByEmail.get(h.pocs[0]), poc2_id: idByEmail.get(h.pocs[1]), poc3_id: idByEmail.get(h.pocs[2]), active: h.active })),
    { onConflict: "name" },
  ),
  "upsert hubs",
);
const hubId = new Map(must(await db.from("hubs").select("id,name"), "read hubs").map((h) => [h.name, h.id]));

const seen = new Set();
const shiftRows = [];
for (const s of shifts) {
  const k = `${s.hub}|${s.start}|${s.end}`;
  if (seen.has(k)) continue; // an exact duplicate row means nothing
  seen.add(k);
  shiftRows.push({ hub_id: hubId.get(s.hub), start_time: s.start, end_time: s.end, active: true });
}
must(await db.from("hub_shifts").upsert(shiftRows, { onConflict: "hub_id,start_time,end_time" }), "upsert shifts");
if (prune) {
  const all = must(await db.from("hub_shifts").select("id,hub_id,start_time,end_time,active"), "read shifts");
  const idToHub = new Map([...hubId].map(([n, id]) => [id, n]));
  const off = all.filter((s) => s.active && idToHub.has(s.hub_id) && !seen.has(`${idToHub.get(s.hub_id)}|${s.start_time}|${s.end_time}`)).map((s) => s.id);
  if (off.length) must(await db.from("hub_shifts").update({ active: false }).in("id", off), "prune shifts");
  console.log(`Switched off ${off.length} shift(s) that are not in the sheet.`);
}

for (const g of globals) {
  must(await db.from("global_contacts").upsert({ role: g.role, person_id: idByEmail.get(g.email) }, { onConflict: "role,person_id" }), "upsert global contact");
}

// first-run defaults that must not live in the public repo
const cfgRows = must(await db.from("app_config").select("key,value").in("key", ["dry_run_to", "placeholder_emails"]), "read config");
const cfgNow = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
const setCfg = async (k, v) => must(await db.from("app_config").upsert({ key: k, value: v, updated_at: new Date().toISOString(), updated_by: "import" }), `set ${k}`);
if (!cfgNow.dry_run_to) {
  const admin = globals.find((g) => g.role === "SYSTEM_ADMIN");
  if (admin) {
    await setCfg("dry_run_to", admin.email);
    console.log(`Dry-run address set to ${admin.email} (test emails go only there).`);
  }
}
if (!Array.isArray(cfgNow.placeholder_emails) || cfgNow.placeholder_emails.length === 0) {
  // a person sitting in all three POC slots of a hub is a stand-in, not a real chain
  const stand = new Set(hubs.filter((h) => h.pocs[0] === h.pocs[1] && h.pocs[1] === h.pocs[2]).map((h) => h.pocs[0]));
  if (stand.size) {
    await setCfg("placeholder_emails", [...stand]);
    console.log(`Marked as placeholders: ${[...stand].join(", ")} (change in Settings if wrong).`);
  }
}

console.log(`Done. People +${fresh.length} new, ${zones.length} zones, ${hubs.length} hubs, ${shiftRows.length} shifts, ${globals.length} global contacts.`);
