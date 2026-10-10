import { clientIp, json, resolveLink, UUID_RE } from "@/lib/auth";
import { submitEntries, type EntryItem } from "@/lib/entry";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    let body: { token?: unknown; email?: unknown; items?: unknown; confirm?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Bad request." }, 400);
    }
    if (!body || typeof body !== "object" || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
      return json({ ok: false, error: "Bad request." }, 400);
    }
    // every row must be an object with a real shift id: anything else is refused here, not deep in the database
    const items: EntryItem[] = [];
    for (const it of body.items as unknown[]) {
      if (!it || typeof it !== "object" || typeof (it as EntryItem).roundId !== "string" || !UUID_RE.test((it as EntryItem).roundId)) {
        return json({ ok: false, error: "Bad request." }, 400);
      }
      items.push(it as EntryItem);
    }
    const confirm = body.confirm === true;

    let result;
    if (typeof body.token === "string" && body.token) {
      const l = await resolveLink(body.token, ["poc", "delegate"]);
      if (!l.ok) return json({ ok: false, error: l.reason === "expired" ? "This link has expired." : "This link is not valid." }, 403);
      result = await submitEntries({
        items, email: typeof body.email === "string" ? body.email : "", source: l.link.kind === "delegate" ? "delegate" : "link",
        tokenId: l.link.id, allowedRoundIds: l.link.roundIds, confirm, ip: clientIp(req), userAgent: req.headers.get("user-agent"),
      });
    } else {
      const s = await getSession();
      if (!s) return json({ ok: false, error: "Please log in." }, 401);
      result = await submitEntries({ items, email: s.email, source: "dashboard", confirm, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    }
    return json(result, result.ok || result.needsConfirm ? 200 : result.status ?? 400);
  } catch (e) {
    console.error("entry failed", e);
    return json({ ok: false, error: "Could not save just now. Please try again in a moment." }, 503);
  }
}
