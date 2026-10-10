import { json } from "@/lib/auth";
import { db } from "@/lib/db";
import { mailerConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/** For the free uptime monitor. Returns 503 if the scheduler has not ticked for 3 minutes. */
export async function GET() {
  try {
    // time three sequential database round trips from the server, to spot a slow region
    const t0 = performance.now();
    const hb = await db().from("heartbeat").select("last_tick,info").eq("id", 1).single();
    const t1 = performance.now();
    const pending = await db().from("outbox").select("id", { count: "exact", head: true }).eq("status", "pending");
    const failed = await db().from("outbox").select("id", { count: "exact", head: true }).eq("status", "failed");
    const dbMsPerQuery = Math.round((performance.now() - t0) / 3);
    const firstQueryMs = Math.round(t1 - t0);
    // gateway-only round trips (no query): separates "far away" from "slow query path"
    const gw: number[] = [];
    for (let i = 0; i < 3; i++) {
      const g0 = performance.now();
      await fetch(`${process.env.SUPABASE_URL}/auth/v1/health`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "" } }).catch(() => null);
      gw.push(Math.round(performance.now() - g0));
    }

    const age = hb.data ? Math.round((Date.now() - new Date(hb.data.last_tick).getTime()) / 1000) : null;
    const enabled = (hb.data?.info as { enabled?: boolean } | null)?.enabled !== false;
    const healthy = !enabled || (age !== null && age < 180);
    return json(
      {
        ok: healthy, tickAgeSeconds: age, enabled, mailerConfigured: mailerConfigured(),
        emailsPending: pending.count ?? 0, emailsFailed: failed.count ?? 0,
        functionRegion: process.env.VERCEL_REGION ?? "local", dbMsPerQuery, firstQueryMs, gatewayMs: gw,
      },
      healthy ? 200 : 503,
    );
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 503);
  }
}
