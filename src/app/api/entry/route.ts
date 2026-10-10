import { clientIp, json, resolveLink } from "@/lib/auth";
import { submitEntries, type EntryItem } from "@/lib/entry";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { token?: unknown; email?: unknown; items?: unknown; confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  if (!Array.isArray(body.items)) return json({ ok: false, error: "Bad request." }, 400);
  const items = body.items as EntryItem[];
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
  return json(result, result.ok || result.needsConfirm ? 200 : 400);
}
