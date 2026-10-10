import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- a tiny in-memory stand-in for the database, just enough for the alert logic
type Row = Record<string, unknown>;
const store: { alerts: Row[]; outbox: Row[]; link_tokens: Row[] } = { alerts: [], outbox: [], link_tokens: [] };
let seq = 0;

class Q {
  private filters: [string, unknown][] = [];
  private gteFilters: [string, string][] = [];
  private isNull: string[] = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Row = {};
  private wantSingle = false;
  constructor(private table: keyof typeof store) {}
  select() { return this; }
  eq(k: string, v: unknown) { this.filters.push([k, v]); return this; }
  gte(k: string, v: string) { this.gteFilters.push([k, v]); return this; }
  limit() { return this; }
  is(k: string) { this.isNull.push(k); return this; }
  insert(p: Row) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  upsert(p: Row) { this.op = "upsert"; this.payload = p; return this; }
  single() { this.wantSingle = true; return this; }
  private run() {
    const t = store[this.table];
    const match = (r: Row) =>
      this.filters.every(([k, v]) => r[k] === v) &&
      this.gteFilters.every(([k, v]) => String(r[k] ?? "") >= v) &&
      this.isNull.every((k) => r[k] === null || r[k] === undefined);
    if (this.op === "insert") {
      const row = { id: `id${++seq}`, resolved_at: null, created_at: new Date().toISOString(), ...this.payload };
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
  mustOk: (res: { error: { message: string } | null }) => {
    if (res.error) throw new Error(res.error.message);
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

describe("alert robustness", () => {
  it("a worse shortfall on an open LOW alert is stored and sent to the same people as an update", async () => {
    await applyAlert(ctx(100, 88)); // short by 12
    expect(store.outbox).toHaveLength(3);
    await applyAlert(ctx(100, 60)); // now short by 40
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0].adhoc_needed).toBe(40);
    const updates = store.outbox.filter((o) => (o.subject as string).startsWith("UPDATE: LOW MANPOWER"));
    expect(updates).toHaveLength(3);
    expect(updates.every((o) => (o.subject as string).includes("now short by 40"))).toBe(true);
    expect(updates.map((o) => o.to_email).sort()).toEqual(["ops@xpressbees.com", "zonehr@xpressbees.com", "zonerm@xpressbees.com"]);
  });

  it("the same corrected number saved twice does not send the update twice", async () => {
    await applyAlert(ctx(100, 88));
    await applyAlert(ctx(100, 60));
    await applyAlert(ctx(100, 60));
    expect(store.outbox).toHaveLength(6);
  });

  it("emails lost to a crash are queued again when the same numbers are saved once more", async () => {
    await applyAlert(ctx(100, 88));
    store.outbox.length = 0; // pretend the emails never made it
    await applyAlert(ctx(100, 88));
    expect(sentTo()).toEqual(["ops@xpressbees.com", "zonehr@xpressbees.com", "zonerm@xpressbees.com"]);
    expect(store.outbox.every((o) => !(o.subject as string).startsWith("UPDATE"))).toBe(true);
    expect(store.alerts).toHaveLength(1);
  });

  it("LOW corrected to EXCESS tells the people who were alerted that the shortfall is over", async () => {
    await applyAlert(ctx(100, 88));
    store.outbox.length = 0;
    expect(await applyAlert(ctx(100, 125))).toBe("EXCESS");
    expect(store.outbox.every((o) => o.kind === "resolved")).toBe(true);
    expect(sentTo()).toEqual(["ops@xpressbees.com", "zonehr@xpressbees.com", "zonerm@xpressbees.com"]);
    expect(store.alerts.filter((a) => a.resolved_at === null).map((a) => a.class)).toEqual(["EXCESS"]);
  });

  it("a shift that keeps flipping LOW / OK cannot flood HR: emails stop after a few", async () => {
    for (let i = 0; i < 6; i++) {
      await applyAlert(ctx(100, 80));
      await applyAlert(ctx(100, 100));
    }
    const afterSix = store.outbox.length;
    expect(afterSix).toBeLessThanOrEqual(24);
    for (let i = 0; i < 6; i++) {
      await applyAlert(ctx(100, 80));
      await applyAlert(ctx(100, 100));
    }
    expect(store.outbox.length).toBe(afterSix); // nothing more is sent
    expect(store.alerts.length).toBeGreaterThan(6); // but every one is still recorded for the dashboard
  });

  it("an acknowledge link made for a late edit is valid for a day from NOW, not from the long-gone cut-off", async () => {
    const c = ctx(100, 80);
    c.cutoffAt = new Date("2020-01-01T00:00:00Z");
    await applyAlert(c);
    const link = store.link_tokens[0];
    expect(new Date(link.expires_at as string).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });
});
