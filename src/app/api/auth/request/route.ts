import { json } from "@/lib/auth";
import { isAllowedEmail, loadConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { loginCodeEmail } from "@/lib/emails";
import { mailerConfigured, sendMail } from "@/lib/mailer";
import { hashToken, newLoginCode } from "@/lib/tokens";

export const dynamic = "force-dynamic";

/** Step 1 of login: email a 6-digit code to an XB address. Same reply whether or not it was sent. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const cfg = await loadConfig();
  const email = (body.email ?? "").trim().toLowerCase();
  if (!isAllowedEmail(email, cfg)) return json({ ok: false, error: "Please use your XB email address." }, 400);
  if (!mailerConfigured()) return json({ ok: false, error: "Email sending is not set up yet." }, 503);

  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const recent = await db().from("login_codes").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", since);
  if ((recent.count ?? 0) >= 3) return json({ ok: false, error: "Too many requests. Please wait a few minutes." }, 429);

  const code = newLoginCode();
  await db().from("login_codes").insert({ email, code_hash: hashToken(`${email}:${code}`), expires_at: new Date(Date.now() + 10 * 60000).toISOString() });
  const m = loginCodeEmail({ code });
  try {
    // login codes always go to the person asking, even in dry-run mode
    await sendMail({ to: email, subject: m.subject, html: m.html, text: m.text, fromName: cfg.senderDisplayName });
  } catch (e) {
    console.error("login email failed", e);
    return json({ ok: false, error: "Could not send the email. Please try again." }, 502);
  }
  return json({ ok: true });
}
