// Used by the browser code. One safe way to call our own API: a network failure, a timeout or an
// HTML error page never throws, it comes back as a normal result with a human-readable message.
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** a message that can be shown to a person */
  error: string | null;
}

export async function postJson<T extends { ok?: boolean; error?: string } = { ok?: boolean; error?: string }>(
  url: string,
  body: unknown,
  timeoutMs = 45_000,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, status: 0, data: null, error: "No connection. Please check your internet and try again." };
  }
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    return { ok: false, status: res.status, data: null, error: "The server is busy or had a problem. Please try again in a moment." };
  }
  const ok = res.ok && data?.ok !== false;
  return { ok, status: res.status, data, error: ok ? null : (data?.error ?? "Something went wrong. Please try again.") };
}

/** Whole digits only: "12.5" becomes "12", "-5" becomes "". Never silently glues "12.5" into 125. */
export function leadingDigits(v: string, max = 5): string {
  const m = /^\s*(\d+)/.exec(v);
  return m ? m[1].slice(0, max) : "";
}
