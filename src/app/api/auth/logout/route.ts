import { json } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
}
