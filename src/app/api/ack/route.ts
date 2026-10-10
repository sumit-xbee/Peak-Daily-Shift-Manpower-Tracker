import { clientIp, json, resolveLink } from "@/lib/auth";
import { isAllowedEmail, loadConfig } from "@/lib/config";
import { audit, db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The Zone HR acknowledges a LOW alert and states the action / ETA. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; email?: string; eta?: string; note?: string };
  const cfg = await loadConfig();
  if (!body.token) return json({ ok: false, error: "Bad request." }, 400);
  const l = await resolveLink(body.token, ["ack"]);
  if (!l.ok || !l.link.alertId) return json({ ok: false, error: l.ok ? "This link is not valid." : l.reason === "expired" ? "This link has expired." : "This link is not valid." }, 403);
  if (!body.email || !isAllowedEmail(body.email, cfg)) return json({ ok: false, error: "Please enter your XB email." }, 400);
  const eta = (body.eta ?? "").trim().slice(0, 200);
  if (!eta) return json({ ok: false, error: "Please enter the action or ETA." }, 400);

  const email = body.email.trim().toLowerCase();
  const upd = await db()
    .from("alerts")
    .update({ acked_by: email, acked_at: new Date().toISOString(), ack_eta: eta, ack_note: (body.note ?? "").trim().slice(0, 500) || null })
    .eq("id", l.link.alertId)
    .is("acked_at", null)
    .select("id");
  if (upd.error) return json({ ok: false, error: "Could not save. Please try again." }, 500);
  await audit(email, "alert_ack", { alertId: l.link.alertId, ip: clientIp(req) });
  return json({ ok: true, already: (upd.data?.length ?? 0) === 0 });
}
