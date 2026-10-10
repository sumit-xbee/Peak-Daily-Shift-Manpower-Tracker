import { createHash } from "node:crypto";
import type { Config } from "./config";
import { db, must } from "./db";
import type { Rendered } from "./emails";
import { hashToken, newToken } from "./tokens";

export interface OutMsg extends Rendered {
  dedupeKey: string;
  kind: string; // open | reminder | l3 | rm_ops | low_alert | excess_alert | resolved | ack_reminder | unack | digest | system
  roundId?: string | null;
  toName: string;
  toEmail: string;
  sendAfter?: Date;
}

/** Queue one email. Safe to call twice: the dedupe key makes the second call a no-op. Returns true if newly queued. */
export async function enqueue(m: OutMsg): Promise<boolean> {
  const { data, error } = await db()
    .from("outbox")
    .upsert(
      {
        dedupe_key: m.dedupeKey,
        kind: m.kind,
        round_id: m.roundId ?? null,
        to_name: m.toName,
        to_email: m.toEmail.toLowerCase(),
        subject: m.subject,
        html: m.html,
        text_body: m.text,
        send_after: (m.sendAfter ?? new Date()).toISOString(),
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`enqueue ${m.dedupeKey}: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Has an email with this dedupe key already been queued? */
export async function isQueued(dedupeKey: string): Promise<boolean> {
  const { data, error } = await db().from("outbox").select("id").eq("dedupe_key", dedupeKey).limit(1);
  if (error) throw new Error(`check queue: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Stable short id for a set of round ids (used in dedupe keys). */
export const groupId = (ids: string[]) =>
  createHash("sha1").update([...ids].sort().join(",")).digest("hex").slice(0, 16);

export interface LinkParams {
  kind: "poc" | "delegate" | "ack";
  personId?: string | null;
  roundIds: string[];
  alertId?: string | null;
  parentTokenId?: string | null;
  createdBy?: string | null;
  expiresAt: Date;
}

/** Create a secure link token. Only the hash is stored; the raw token goes into the email only. */
export async function createLink(p: LinkParams): Promise<{ token: string; id: string }> {
  const token = newToken();
  const row = must(
    await db()
      .from("link_tokens")
      .insert({
        token_hash: hashToken(token),
        kind: p.kind,
        person_id: p.personId ?? null,
        round_ids: p.roundIds,
        alert_id: p.alertId ?? null,
        parent_token_id: p.parentTokenId ?? null,
        created_by_email: p.createdBy ?? null,
        expires_at: p.expiresAt.toISOString(),
      })
      .select("id")
      .single(),
    "create link",
  ) as { id: string };
  return { token, id: row.id };
}

export const entryUrl = (cfg: Config, token: string) => `${cfg.appBaseUrl}/e/${token}`;
export const ackUrl = (cfg: Config, token: string) => `${cfg.appBaseUrl}/ack/${token}`;
export const dashboardUrl = (cfg: Config) => `${cfg.appBaseUrl}/dashboard`;

/** Email the system administrators (SYSTEM_ADMIN). Deduplicated by key. */
export async function notifyAdmins(
  admins: { name: string; email: string }[],
  key: string,
  r: Rendered,
): Promise<void> {
  for (const a of admins) {
    await enqueue({ ...r, dedupeKey: `${key}:${a.email.toLowerCase()}`, kind: "system", toName: a.name, toEmail: a.email });
  }
}
