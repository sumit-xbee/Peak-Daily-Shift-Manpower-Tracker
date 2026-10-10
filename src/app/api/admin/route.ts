import { addSkipDate, bulkAssign, replacePerson, setGlobalContact, setHubActive, setHubPocs, setZoneContacts } from "@/lib/admin";
import { isAdminEmail, json } from "@/lib/auth";
import { clearConfigOverride, setConfigValue } from "@/lib/config";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return json({ ok: false, error: "Please log in." }, 401);
  if (!(await isAdminEmail(s.email))) return json({ ok: false, error: "Admins only." }, 403);
  const b = (await req.json().catch(() => null)) as any;
  if (!b || typeof b.action !== "string") return json({ ok: false, error: "Bad request." }, 400);

  try {
    switch (b.action) {
      case "setHubPocs": return json(await setHubPocs(s.email, b.hubId, b.pocs ?? []));
      case "replacePerson": return json(await replacePerson(s.email, b));
      case "bulkAssign": return json(await bulkAssign(s.email, b.hubIds ?? [], b.pocs ?? []));
      case "setZoneContacts": return json(await setZoneContacts(s.email, b.zoneId, b.rm, b.hr));
      case "setHubActive": return json(await setHubActive(s.email, b.hubId, b.active === true));
      case "setGlobalContact": return json(await setGlobalContact(s.email, b.role, b.person, b.remove === true));
      case "addSkipDate": return json(await addSkipDate(s.email, b.hubId, b.date, b.reason ?? ""));
      case "setConfig": {
        if (typeof b.key !== "string" || !/^[a-z0-9_]{1,60}$/.test(b.key)) return json({ ok: false, error: "Bad key." }, 400);
        await setConfigValue(b.key, b.value, s.email, typeof b.hubId === "string" ? b.hubId : undefined);
        return json({ ok: true });
      }
      case "clearOverride": {
        if (typeof b.hubId !== "string" || typeof b.key !== "string") return json({ ok: false, error: "Bad request." }, 400);
        await clearConfigOverride(b.hubId, b.key, s.email);
        return json({ ok: true });
      }
      default: return json({ ok: false, error: "Unknown action." }, 400);
    }
  } catch (e) {
    console.error("admin action failed", b.action, e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Failed." }, 500);
  }
}
