import { addSkipDate, bulkAssign, replacePerson, requeueFailedEmails, setGlobalContact, setHubActive, setHubPocs, setZoneContacts } from "@/lib/admin";
import { isAdminEmail, json, UUID_RE } from "@/lib/auth";
import { loadConfig, setConfigValue, clearConfigOverride } from "@/lib/config";
import { validateConfigValue } from "@/lib/configdefs";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return json({ ok: false, error: "Please log in." }, 401);
  let b: any;
  try {
    if (!(await isAdminEmail(s.email))) return json({ ok: false, error: "Admins only." }, 403);
    b = await req.json().catch(() => null);
    if (!b || typeof b !== "object" || typeof b.action !== "string") return json({ ok: false, error: "Bad request." }, 400);

    switch (b.action) {
      case "setHubPocs": return json(await setHubPocs(s.email, String(b.hubId), Array.isArray(b.pocs) ? b.pocs : []));
      case "replacePerson": return json(await replacePerson(s.email, b));
      case "bulkAssign": return json(await bulkAssign(s.email, Array.isArray(b.hubIds) ? b.hubIds.map(String) : [], Array.isArray(b.pocs) ? b.pocs : []));
      case "setZoneContacts": return json(await setZoneContacts(s.email, String(b.zoneId), b.rm, b.hr));
      case "setHubActive": return json(await setHubActive(s.email, String(b.hubId), b.active === true));
      case "setGlobalContact": return json(await setGlobalContact(s.email, b.role, b.person, b.remove === true));
      case "addSkipDate": return json(await addSkipDate(s.email, String(b.hubId), String(b.date), typeof b.reason === "string" ? b.reason : ""));
      case "requeueFailed": return json(await requeueFailedEmails(s.email));
      case "setConfig": {
        const hubId = typeof b.hubId === "string" ? b.hubId : undefined;
        if (hubId && !UUID_RE.test(hubId)) return json({ ok: false, error: "Bad hub." }, 400);
        const cfg = await loadConfig(true);
        const err = validateConfigValue(String(b.key), b.value, { hub: Boolean(hubId), allowedDomains: cfg.allowedDomains });
        if (err) return json({ ok: false, error: err }, 400);
        await setConfigValue(String(b.key), b.value, s.email, hubId);
        return json({ ok: true });
      }
      case "clearOverride": {
        if (typeof b.hubId !== "string" || !UUID_RE.test(b.hubId) || typeof b.key !== "string") return json({ ok: false, error: "Bad request." }, 400);
        const err = validateConfigValue(b.key, undefined as never, { hub: true });
        if (err === "Unknown setting." || err === "This setting cannot be set per hub.") return json({ ok: false, error: err }, 400);
        await clearConfigOverride(b.hubId, b.key, s.email);
        return json({ ok: true });
      }
      default: return json({ ok: false, error: "Unknown action." }, 400);
    }
  } catch (e) {
    console.error("admin action failed", b?.action, e);
    return json({ ok: false, error: "That did not complete. Please check the page and try again." }, 500);
  }
}
