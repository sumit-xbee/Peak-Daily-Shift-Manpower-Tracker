import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** A database call that takes longer than this is abandoned, so one hung request cannot freeze a page or the scheduler. */
const FETCH_TIMEOUT_MS = 15_000;

/** Server-side Supabase client using the secret key. Never import this in client components. */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) }) },
    });
  }
  return client;
}

/** Unwrap a Supabase result or throw with context. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, ctx: string): T {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return res.data as T;
}

/** Throw if a write failed (for results where no data is needed). */
export function mustOk(res: { error: { message: string } | null }, ctx: string): void {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = (q: any) => any;

/**
 * Read every row of a table (PostgREST returns at most 1000 per request).
 * Pages are ordered by `order` so rows are never skipped or repeated between pages.
 */
export async function selectAll<T = Record<string, unknown>>(
  table: string,
  columns = "*",
  build?: QueryBuilder,
  order: string[] = ["id"],
): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db().from(table).select(columns);
    if (build) q = build(q);
    for (const col of order) q = q.order(col, { ascending: true });
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

/** Audit trail entry. Never lets a failed audit write break the action that was audited. */
export async function audit(actor: string | null, action: string, details?: unknown) {
  const { error } = await db().from("audit_log").insert({ actor_email: actor, action, details: details ?? null });
  if (error) console.error("audit write failed", action, error.message);
}
