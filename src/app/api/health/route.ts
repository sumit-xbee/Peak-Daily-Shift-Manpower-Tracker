import { json } from "@/lib/auth";
import { db } from "@/lib/db";
import { mailerConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/** For the free uptime monitor. Returns 503 if the scheduler has not ticked for 3 minutes. */
export async function GET() {
  try {
    const hb = await db().from("heartbeat").select("last_tick,info").eq("id", 1).single();
    const age = hb.data ? Math.round((Date.now() - new Date(hb.data.last_tick).getTime()) / 1000) : null;
    const pending = await db().from("outbox").select("id", { count: "exact", head: true }).eq("status", "pending");
    const failed = await db().from("outbox").select("id", { count: "exact", head: true }).eq("status", "failed");
    const enabled = (hb.data?.info as { enabled?: boolean } | null)?.enabled !== false;
    const healthy = !enabled || (age !== null && age < 180);
    return json(
      { ok: healthy, tickAgeSeconds: age, enabled, mailerConfigured: mailerConfigured(), emailsPending: pending.count ?? 0, emailsFailed: failed.count ?? 0 },
      healthy ? 200 : 503,
    );
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 503);
  }
}
