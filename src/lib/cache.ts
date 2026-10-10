// Tiny in-memory cache with a time limit. It keeps rarely-changing data (people, hubs, shifts,
// settings) off the database for a few seconds, because every database round trip costs
// 150-300 ms from the app server. The scheduler and anything that writes always read fresh.
interface Entry<T> {
  at: number;
  value?: T;
  inflight?: Promise<T>;
}

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, fresh = false): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (!fresh && hit) {
    if (hit.inflight) return hit.inflight; // share one load between simultaneous requests
    if (hit.value !== undefined && now - hit.at < ttlMs) return hit.value;
  }
  const p = load().then(
    (v) => {
      store.set(key, { at: Date.now(), value: v });
      return v;
    },
    (e) => {
      store.delete(key);
      throw e;
    },
  );
  store.set(key, { at: now, inflight: p });
  return p;
}

/** Forget everything (called after an admin change, so the next page sees it at once). */
export const invalidateCaches = () => store.clear();
