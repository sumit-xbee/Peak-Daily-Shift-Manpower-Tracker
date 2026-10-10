// Tiny in-memory cache with a time limit. It keeps rarely-changing data (people, hubs, shifts,
// settings) off the database for a few seconds, because every database round trip costs
// 150-300 ms from the app server. The scheduler and anything that writes always read fresh.
// Each server instance has its own cache, so another instance may show data up to the TTL old.
interface Entry<T> {
  at: number;
  value?: T;
  inflight?: Promise<T>;
}

const store = new Map<string, Entry<unknown>>();
let generation = 0;

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, fresh = false): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (!fresh && hit) {
    if (hit.inflight) return hit.inflight; // share one load between simultaneous requests
    if (hit.value !== undefined && now - hit.at < ttlMs) return hit.value;
  }
  const startedIn = generation;
  const entry: Entry<T> = { at: now };
  const p: Promise<T> = load().then(
    (v) => {
      // a clear() that happened while this load was running means the data may already be stale: don't keep it
      if (generation === startedIn && store.get(key) === (entry as Entry<unknown>)) store.set(key, { at: Date.now(), value: v });
      else if (store.get(key) === (entry as Entry<unknown>)) store.delete(key);
      return v;
    },
    (e) => {
      if (store.get(key) === (entry as Entry<unknown>)) store.delete(key);
      throw e;
    },
  );
  entry.inflight = p;
  store.set(key, entry as Entry<unknown>);
  return p;
}

/** Forget everything (called after an admin change, so the next page sees it at once). */
export function invalidateCaches() {
  generation++;
  store.clear();
}
