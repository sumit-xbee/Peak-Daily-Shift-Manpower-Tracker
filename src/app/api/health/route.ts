import { bearerMatches, json } from "@/lib/auth";
import { db } from "@/lib/db";
import { mailerConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/**
 * For the free uptime monitor. Public answer: only whether the system is healthy (200) or not (503).
 * With the CRON_SECRET as a Bearer token it also returns details (counts, timings, last errors).
 * Unhealthy means: the scheduler has not ticked for 3 minutes, its last run had errors,
 * or emails have been failing / stuck.
 */
export async function GET(req: Request) {
  const detailed = bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET);
  try {
    const t0 = performance.now();
    const hb = await db().from("heartbeat").select("last_tick,info").eq("id", 1).single();
    if (hb.error) throw new Error(hb.error.message);
    const t1 = performance.now();
    const hourAgo = new Date(Date.now() - 60 * 60000).toISOString();
    const quarterAgo = new Date(Date.now() - 15 * 60000).toISOString();
    const [failed, stuck] = await Promise.all([
      db().from("outbox").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", hourAgo),
      db().from("outbox").select("id", { count: "exact", head: true }).eq("status", "pending").lt("created_at", quarterAgo).lte("send_after", new Date().toISOString()),
    ]);
    const age = Math.round((Date.now() - new Date(hb.data.last_tick).getTime()) / 1000);
    const info = (hb.data.info ?? {}) as { enabled?: boolean; errors?: string[] };
    const enabled = info.enabled !== false;
    const tickErrors = info.errors ?? [];
    const healthy = !enabled || (age < 180 && tickErrors.length === 0 && (failed.count ?? 0) === 0 && (stuck.count ?? 0) === 0);
    const body: Record<string, unknown> = { ok: healthy };
    if (detailed) {
      Object.assign(body, {
        tickAgeSeconds: age, enabled, tickErrors, mailerConfigured: mailerConfigured(),
        emailsFailedLastHour: failed.count ?? 0, emailsStuckOver15Min: stuck.count ?? 0,
        functionRegion: process.env.VERCEL_REGION ?? "local", firstQueryMs: Math.round(t1 - t0),
      });
    }
    return json(body, healthy ? 200 : 503);
  } catch (e) {
    console.error("health check failed", e);
    return json({ ok: false }, 503);
  }
}
