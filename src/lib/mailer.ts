import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

export function mailerConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function getTransporter(): Transporter {
  if (!transporter) {
    if (!mailerConfigured()) throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must be set");
    // Gmail SMTP over implicit TLS on port 465 (port 587 is blocked on many serverless hosts).
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 1,
      // a stuck connection must fail fast, well inside the 60 s the scheduler is allowed to run
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      auth: { user: process.env.GMAIL_USER, pass: (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "") },
    });
  }
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName: string;
  replyTo?: string;
}

export async function sendMail(m: MailInput): Promise<void> {
  await getTransporter().sendMail({
    from: { name: m.fromName, address: process.env.GMAIL_USER as string },
    to: m.to,
    subject: m.subject,
    html: m.html,
    text: m.text,
    replyTo: m.replyTo || undefined,
    headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
  });
}
