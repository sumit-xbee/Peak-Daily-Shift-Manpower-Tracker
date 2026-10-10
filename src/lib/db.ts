import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Server-side Supabase client using the secret key. Never import this in client components. */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** Unwrap a Supabase result or throw with context. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, ctx: string): T {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return res.data as T;
}

/** Read every row of a table (PostgREST returns at most 1000 per request). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = (q: any) => any;

export async function selectAll<T = Record<string, unknown>>(
  table: string,
  columns = "*",
  build?: QueryBuilder,
): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db().from(table).select(columns);
    if (build) q = build(q);
    const { data, error } = await q.range(from, from + page - 1);
    if (error) throw new Error(`select ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return out;
}

/** Split an array for `.in()` queries so the URL stays short. */
export function chunk<T>(arr: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function audit(actor: string | null, action: string, details?: unknown) {
  await db().from("audit_log").insert({ actor_email: actor, action, details: details ?? null });
}
