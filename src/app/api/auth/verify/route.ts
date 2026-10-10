import { json } from "@/lib/auth";
import { db } from "@/lib/db";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { hashToken, safeEqualHex } from "@/lib/tokens";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/** Step 2 of login: check the code and start a 12-hour session. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();
  if (!email || !/^\d{6}$/.test(code)) return json({ ok: false, error: "Enter the 6-digit code." }, 400);

  const { data } = await db()
    .from("login_codes")
    .select("id,code_hash,attempts,expires_at")
    .eq("email", email)
    .eq("used", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return json({ ok: false, error: "That code has expired. Ask for a new one." }, 400);
  if (data.attempts >= 5) return json({ ok: false, error: "Too many wrong tries. Ask for a new code." }, 429);

  await db().from("login_codes").update({ attempts: data.attempts + 1 }).eq("id", data.id);
  if (!safeEqualHex(data.code_hash, hashToken(`${email}:${code}`))) return json({ ok: false, error: "Wrong code." }, 400);

  await db().from("login_codes").update({ used: true }).eq("id", data.id);
  (await cookies()).set(SESSION_COOKIE, await signSession(email), sessionCookieOptions);
  return json({ ok: true });
}
