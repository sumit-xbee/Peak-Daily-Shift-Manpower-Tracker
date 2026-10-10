import { json } from "@/lib/auth";
import { baseEmail, isAllowedEmail, loadConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { loginCodeEmail } from "@/lib/emails";
import { mailerConfigured, sendMail } from "@/lib/mailer";
import { hashToken, newLoginCode } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const MIN = 60_000;

/**
 * Step 1 of login: email a 6-digit code to an XB address. Same reply whether or not it was sent.
 * Limits are counted per MAILBOX (name+tag@ and name@ are the same mailbox), and across the whole app,
 * so neither one person's inbox nor the shared Gmail sender can be flooded.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const cfg = await loadConfig();
    if (!isAllowedEmail(body.email, cfg)) return json({ ok: false, error: "Please use your XB email address." }, 400);
    const typed = (body.email as string).trim().toLowerCase();
    const base = baseEmail(typed);
    if (!mailerConfigured()) return json({ ok: false, error: "Email sending is not set up yet." }, 503);

    if (cfg.loginKnownOnly) {
      const known = await db().from("people").select("id").eq("email", base).limit(1);
      if (known.error) throw new Error(known.error.message);
      if (!known.data?.length) return json({ ok: true }); // same answer, no code, so nobody can probe who is listed
    }

    const count = async (since: number, email?: string) => {
      let q = db().from("login_codes").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - since).toISOString());
      if (email) q = q.eq("email", email);
      const r = await q;
      if (r.error) throw new Error(r.error.message);
      return r.count ?? 0;
    };
    const [last10, lastDay, app10] = await Promise.all([count(10 * MIN, base), count(24 * 60 * MIN, base), count(10 * MIN)]);
    if (last10 >= 3 || lastDay >= 10) return json({ ok: false, error: "Too many requests. Please wait a while and try again." }, 429);
    if (app10 >= 60) return json({ ok: false, error: "The service is busy. Please try again in a few minutes." }, 429);

    const code = newLoginCode();
    const ins = await db().from("login_codes").insert({ email: base, code_hash: hashToken(`${base}:${code}`), expires_at: new Date(Date.now() + 10 * MIN).toISOString() });
    if (ins.error) throw new Error(ins.error.message);
    const m = loginCodeEmail({ code });
    // login codes always go to the person asking, even in dry-run mode
    await sendMail({ to: typed, subject: m.subject, html: m.html, text: m.text, fromName: cfg.senderDisplayName });
    return json({ ok: true });
  } catch (e) {
    console.error("login request failed", e);
    return json({ ok: false, error: "Could not send the email. Please try again." }, 502);
  }
}
