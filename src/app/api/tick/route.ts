import { bearerMatches, json } from "@/lib/auth";
import { runTick } from "@/lib/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "unauthorized" }, 401);
  try {
    return json(await runTick());
  } catch (e) {
    console.error("tick failed", e);
    return json({ error: e instanceof Error ? e.message : "tick failed" }, 500);
  }
}

export const POST = handle;
export const GET = handle;
