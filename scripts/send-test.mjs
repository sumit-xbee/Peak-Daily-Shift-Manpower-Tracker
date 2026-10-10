// Sends ONE test email from the Gmail sender to the sender's own mailbox (or to --to <address>).
//   npm run test:email
// Uses GMAIL_USER and GMAIL_APP_PASSWORD from .env.local. Nothing is stored.
import nodemailer from "nodemailer";

const user = process.env.GMAIL_USER;
const pass = (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");
const toIdx = process.argv.indexOf("--to");
const to = toIdx > -1 ? process.argv[toIdx + 1] : user;

if (!user || !pass) {
  console.error("GMAIL_USER and GMAIL_APP_PASSWORD must be set in .env.local");
  process.exit(1);
}

const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
try {
  await t.verify();
  console.log("SMTP login OK (smtp.gmail.com:465).");
  const info = await t.sendMail({
    from: { name: "XB Peak Shift Tracker", address: user },
    to,
    subject: "Peak Shift Tracker: test email",
    text: "If you can read this, the Gmail sender works. No action needed.",
    html: '<div style="font-family:Arial,sans-serif;padding:16px"><h2 style="margin:0 0 8px">Test email OK</h2><p>If you can read this, the Peak Shift Tracker can send email. No action needed.</p></div>',
  });
  console.log(`Sent to ${to}. Server reply: ${info.response}`);
} catch (e) {
  console.error("FAILED:", e.message);
  if (/Invalid login|535|Username and Password/i.test(e.message)) {
    console.error("Google rejected the login. Check the app password, and that 2-Step Verification is on. If the 'App passwords' page is missing, your Workspace admin has disabled it.");
  }
  process.exit(1);
}
