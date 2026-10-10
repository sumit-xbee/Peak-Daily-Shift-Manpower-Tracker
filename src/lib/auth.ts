import { redirect } from "next/navigation";
import { db } from "./db";
import { getSession, type Session } from "./session";
import { hashToken } from "./tokens";

/** For server pages: send the visitor to /login unless they hold a valid session. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function isAdminEmail(email: string): Promise<boolean> {
  const p = await db().from("people").select("id").eq("email", email.trim().toLowerCase()).maybeSingle();
  if (!p.data) return false;
  const g = await db().from("global_contacts").select("id").eq("role", "SYSTEM_ADMIN").eq("person_id", p.data.id).limit(1);
  return (g.data?.length ?? 0) > 0;
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!(await isAdminEmail(s.email))) redirect("/dashboard");
  return s;
}

export interface LinkInfo {
  id: string;
  kind: "poc" | "delegate" | "ack";
  personId: string | null;
  roundIds: string[];
  alertId: string | null;
  expiresAt: Date;
}

export type LinkLookup = { ok: true; link: LinkInfo } | { ok: false; reason: "invalid" | "expired" };

/** Look up a raw token from a URL. Only the hash is ever stored or compared. */
export async function resolveLink(raw: string, kinds: LinkInfo["kind"][]): Promise<LinkLookup> {
  if (!raw || raw.length < 30 || raw.length > 100) return { ok: false, reason: "invalid" };
  const { data } = await db()
    .from("link_tokens")
    .select("id,kind,person_id,round_ids,alert_id,expires_at,revoked")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();
  if (!data || data.revoked || !kinds.includes(data.kind)) return { ok: false, reason: "invalid" };
  const expiresAt = new Date(data.expires_at);
  if (expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, link: { id: data.id, kind: data.kind, personId: data.person_id, roundIds: data.round_ids, alertId: data.alert_id, expiresAt } };
}

export const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/** Constant-time check of a `Bearer <secret>` header. */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header?.startsWith("Bearer ")) return false;
  const given = hashToken(header.slice(7));
  const want = hashToken(secret);
  return given === want;
}
