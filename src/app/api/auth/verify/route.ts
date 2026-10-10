import { isAdminEmail, json } from "@/lib/auth";
import { baseEmail, isAllowedEmail, loadConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { hashToken, safeEqualHex } from "@/lib/tokens";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * Step 2 of login: check the code and start a 12-hour session.
 * The try counter is a compare-and-set, so parallel guesses cannot all be counted as "try 1":
 * for each stored attempt number only ONE request gets to test a code.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; code?: unknown };
    const cfg = await loadConfig();
    if (!isAllowedEmail(body.email, cfg) || typeof body.code !== "string" || !/^\d{6}$/.test(body.code.trim())) {
      return json({ ok: false, error: "Enter your email and the 6-digit code." }, 400);
    }
    const base = baseEmail(body.email as string);
    const code = body.code.trim();

    const { data, error } = await db()
      .from("login_codes")
      .select("id,code_hash,attempts,expires_at")
      .eq("email", base)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || new Date(data.expires_at).getTime() < Date.now()) return json({ ok: false, error: "That code has expired. Ask for a new one." }, 400);
    if (data.attempts >= 5) return json({ ok: false, error: "Too many wrong tries. Ask for a new code." }, 429);

    const bump = await db().from("login_codes").update({ attempts: data.attempts + 1 }).eq("id", data.id).eq("attempts", data.attempts).select("id");
    if (bump.error) throw new Error(bump.error.message);
    if (!bump.data?.length) return json({ ok: false, error: "Please try again in a moment." }, 429); // another request got this try

    if (!safeEqualHex(data.code_hash, hashToken(`${base}:${code}`))) return json({ ok: false, error: "Wrong code." }, 400);

    // a code can be used once, even if two correct requests arrive together
    const used = await db().from("login_codes").update({ used: true }).eq("id", data.id).eq("used", false).select("id");
    if (used.error) throw new Error(used.error.message);
    if (!used.data?.length) return json({ ok: false, error: "That code was already used." }, 400);

    (await cookies()).set(SESSION_COOKIE, await signSession(base, await isAdminEmail(base)), sessionCookieOptions);
    return json({ ok: true });
  } catch (e) {
    console.error("login verify failed", e);
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
