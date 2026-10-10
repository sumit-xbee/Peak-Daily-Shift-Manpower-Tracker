import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- a tiny in-memory stand-in for the database, just enough for the alert logic
type Row = Record<string, unknown>;
const store: { alerts: Row[]; outbox: Row[]; link_tokens: Row[] } = { alerts: [], outbox: [], link_tokens: [] };
let seq = 0;

class Q {
  private filters: [string, unknown][] = [];
  private isNull: string[] = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Row = {};
  private wantSingle = false;
  constructor(private table: keyof typeof store) {}
  select() { return this; }
  eq(k: string, v: unknown) { this.filters.push([k, v]); return this; }
  is(k: string) { this.isNull.push(k); return this; }
  insert(p: Row) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  upsert(p: Row) { this.op = "upsert"; this.payload = p; return this; }
  single() { this.wantSingle = true; return this; }
  private run() {
    const t = store[this.table];
    const match = (r: Row) => this.filters.every(([k, v]) => r[k] === v) && this.isNull.every((k) => r[k] === null || r[k] === undefined);
    if (this.op === "insert") {
      const row = { id: `id${++seq}`, resolved_at: null, ...this.payload };
      t.push(row);
      return { data: this.wantSingle ? row : [row], error: null };
    }
    if (this.op === "upsert") {
      const dup = t.find((r) => r.dedupe_key === this.payload.dedupe_key);
      if (dup) return { data: [], error: null };
      const row = { id: `id${++seq}`, ...this.payload };
      t.push(row);
      return { data: [row], error: null };
    }
    if (this.op === "update") {
      t.filter(match).forEach((r) => Object.assign(r, this.payload));
      return { data: null, error: null };
    }
    return { data: t.filter(match), error: null };
  }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
    return Promise.resolve(this.run()).then(res, rej);
  }
}

vi.mock("@/lib/db", () => ({
  db: () => ({ from: (t: keyof typeof store) => new Q(t) }),
  must: (res: { data: unknown; error: { message: string } | null }) => {
    if (res.error) throw new Error(res.error.message);
    return res.data;
  },
}));

import { applyAlert, type AlertContext } from "@/lib/alerts";
import { buildConfig } from "@/lib/config";
import type { Hub, Master, Person } from "@/lib/master";

const person = (n: string, e: string): Person => ({ id: n, name: n, email: e });
const POC1 = person("Poc One", "poc1@xpressbees.com");
const POC2 = person("Poc Two", "poc2@xpressbees.com");
const POC3 = person("Poc Three", "poc3@xpressbees.com");
const ZHR = person("Zone HR", "zonehr@xpressbees.com");
const ZRM = person("Zone RM", "zonerm@xpressbees.com");
const OPS = person("Ops Head", "ops@xpressbees.com");
const hub: Hub = { id: "h1", name: "DEL/PC2", active: true, pocs: [POC1, POC2, POC3], zone: { id: "z1", name: "North", rm: ZRM, hr: ZHR } };
const master: Master = { people: new Map(), zones: new Map(), hubs: new Map(), shifts: new Map(), opsHeads: [OPS], admins: [], skips: [] };

const ctx = (planned: number, actual: number, raw = {}): AlertContext => ({
  cfg: { ...buildConfig(raw), appBaseUrl: "https://x.test" },
  master, hub, roundId: "r1", label: "08:00-16:00", cutoffAt: new Date("2030-01-01T00:00:00Z"),
  planned, actual, enteredBy: "poc1@xpressbees.com", enteredAt: new Date(),
});
const sentTo = () => store.outbox.map((o) => o.to_email as string).sort();

beforeEach(() => {
  store.alerts.length = 0;
  store.outbox.length = 0;
  store.link_tokens.length = 0;
});

describe("alert rules (default settings)", () => {
  it("EXCESS (10%+ above plan) is recorded for the dashboard but emails NOBODY", async () => {
    expect(await applyAlert(ctx(100, 115))).toBe("EXCESS");
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0].class).toBe("EXCESS");
    expect(store.outbox).toHaveLength(0);
  });

  it("LOW (actual 10% or more below plan) emails Zone HR, Ops head and Zone RM only", async () => {
    expect(await applyAlert(ctx(100, 88))).toBe("LOW");
    expect(sentTo()).toEqual(["ops@xpressbees.com", "zonehr@xpressbees.com", "zonerm@xpressbees.com"]);
    expect(store.outbox.every((o) => o.kind === "low_alert")).toBe(true);
    expect((store.outbox[0].subject as string)).toBe("LOW MANPOWER: DEL/PC2 08:00-16:00 short by 12");
  });

  it("only the Zone HR gets the Acknowledge link", async () => {
    await applyAlert(ctx(100, 88));
    const hr = store.outbox.find((o) => o.to_email === "zonehr@xpressbees.com")!;
    const ops = store.outbox.find((o) => o.to_email === "ops@xpressbees.com")!;
    expect(hr.html as string).toContain("Acknowledge and give ETA");
    expect(ops.html as string).not.toContain("Acknowledge and give ETA");
    expect(store.alerts[0].ack_required).toBe(true);
  });

  it("exactly 10% short is LOW; 9% short is not", async () => {
    expect(await applyAlert(ctx(200, 180))).toBe("LOW");
    store.alerts.length = 0; store.outbox.length = 0;
    expect(await applyAlert(ctx(100, 91))).toBe("OK");
    expect(store.alerts).toHaveLength(0);
    expect(store.outbox).toHaveLength(0);
  });

  it("the POCs themselves are never emailed an alert", async () => {
    await applyAlert(ctx(100, 50));
    expect(sentTo()).not.toContain("poc1@xpressbees.com");
    expect(sentTo()).not.toContain("poc2@xpressbees.com");
    expect(sentTo()).not.toContain("poc3@xpressbees.com");
  });

  it("saving the same LOW numbers again does not email twice", async () => {
    await applyAlert(ctx(100, 88));
    await applyAlert(ctx(100, 88));
    expect(store.outbox).toHaveLength(3);
    expect(store.alerts).toHaveLength(1);
  });

  it("correcting LOW back to OK tells the same three people it is resolved", async () => {
    await applyAlert(ctx(100, 88));
    store.outbox.length = 0;
    expect(await applyAlert(ctx(100, 96))).toBe("OK");
    expect(sentTo()).toEqual(["ops@xpressbees.com", "zonehr@xpressbees.com", "zonerm@xpressbees.com"]);
    expect(store.outbox.every((o) => o.kind === "resolved")).toBe(true);
  });

  it("an EXCESS that is corrected sends no 'resolved' email either", async () => {
    await applyAlert(ctx(100, 120));
    await applyAlert(ctx(100, 101));
    expect(store.outbox).toHaveLength(0);
  });

  it("if management ever wants excess emailed, it is one setting (not code)", async () => {
    await applyAlert(ctx(100, 120, { alert_recipients_excess: ["ZONE_HR"] }));
    expect(sentTo()).toEqual(["zonehr@xpressbees.com"]);
  });
});
