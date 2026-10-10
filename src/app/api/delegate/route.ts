import { json, resolveLink, UUID_RE } from "@/lib/auth";
import { isAllowedEmail, loadConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { createLink, entryUrl } from "@/lib/notify";

export const dynamic = "force-dynamic";

const MAX_DELEGATES_PER_LINK = 10;

/** "Share just this hub": a link that covers ONE shift only, for a shift in-charge. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { token?: unknown; roundId?: unknown; email?: unknown };
    if (typeof body.token !== "string" || typeof body.roundId !== "string" || !UUID_RE.test(body.roundId)) return json({ ok: false, error: "Bad request." }, 400);
    const l = await resolveLink(body.token, ["poc"]);
    if (!l.ok) return json({ ok: false, error: "This link is not valid." }, 403);
    if (!l.link.roundIds.includes(body.roundId)) return json({ ok: false, error: "This link does not cover that shift." }, 403);

    const made = await db().from("link_tokens").select("id", { count: "exact", head: true }).eq("parent_token_id", l.link.id);
    if (made.error) throw new Error(made.error.message);
    if ((made.count ?? 0) >= MAX_DELEGATES_PER_LINK) return json({ ok: false, error: "Too many shared links were made from this email." }, 429);

    const cfg = await loadConfig();
    const createdBy = isAllowedEmail(body.email, cfg) ? (body.email as string).trim().toLowerCase() : null;
    const link = await createLink({
      kind: "delegate", personId: l.link.personId, roundIds: [body.roundId], parentTokenId: l.link.id, createdBy, expiresAt: l.link.expiresAt,
    });
    return json({ ok: true, url: entryUrl(cfg, link.token) });
  } catch (e) {
    console.error("delegate failed", e);
    return json({ ok: false, error: "Could not create the link. Please try again." }, 503);
  }
}
