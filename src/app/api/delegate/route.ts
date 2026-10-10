import { json, resolveLink } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { createLink, entryUrl } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** "Share just this hub": a link that covers ONE shift only, for a shift in-charge. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; roundId?: string; email?: string };
  if (!body.token || !body.roundId) return json({ ok: false, error: "Bad request." }, 400);
  const l = await resolveLink(body.token, ["poc"]);
  if (!l.ok) return json({ ok: false, error: "This link is not valid." }, 403);
  if (!l.link.roundIds.includes(body.roundId)) return json({ ok: false, error: "This link does not cover that shift." }, 403);
  const cfg = await loadConfig();
  const made = await createLink({
    kind: "delegate", personId: l.link.personId, roundIds: [body.roundId], parentTokenId: l.link.id,
    createdBy: typeof body.email === "string" ? body.email.trim().toLowerCase() : null, expiresAt: l.link.expiresAt,
  });
  return json({ ok: true, url: entryUrl(cfg, made.token) });
}
