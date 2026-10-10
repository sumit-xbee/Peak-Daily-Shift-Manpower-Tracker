import { clientIp, json, resolveLink } from "@/lib/auth";
import { isAllowedEmail, loadConfig } from "@/lib/config";
import { audit, db } from "@/lib/db";

export const dynamic = "force-dynamic";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** The Zone HR acknowledges a LOW alert and states the action / ETA. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { token?: unknown; email?: unknown; eta?: unknown; note?: unknown };
    const cfg = await loadConfig();
    if (typeof body.token !== "string" || !body.token) return json({ ok: false, error: "Bad request." }, 400);
    const l = await resolveLink(body.token, ["ack"]);
    if (!l.ok || !l.link.alertId) return json({ ok: false, error: l.ok ? "This link is not valid." : l.reason === "expired" ? "This link has expired." : "This link is not valid." }, 403);
    if (!isAllowedEmail(body.email, cfg)) return json({ ok: false, error: "Please enter your XB email." }, 400);
    const eta = clip(body.eta, 200);
    if (!eta) return json({ ok: false, error: "Please enter the action or ETA." }, 400);

    const email = (body.email as string).trim().toLowerCase();
    const upd = await db()
      .from("alerts")
      .update({ acked_by: email, acked_at: new Date().toISOString(), ack_eta: eta, ack_note: clip(body.note, 500) || null })
      .eq("id", l.link.alertId)
      .is("acked_at", null)
      .select("id");
    if (upd.error) throw new Error(upd.error.message);
    await audit(email, "alert_ack", { alertId: l.link.alertId, ip: clientIp(req) });
    return json({ ok: true, already: (upd.data?.length ?? 0) === 0 });
  } catch (e) {
    console.error("ack failed", e);
    return json({ ok: false, error: "Could not save. Please try again." }, 503);
  }
}
