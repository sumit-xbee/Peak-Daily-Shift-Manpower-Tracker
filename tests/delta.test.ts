import { describe, expect, it } from "vitest";
import { deltaView } from "@/lib/delta";
import { entriesAsOf } from "@/lib/dashdata";
import type { EntryRow, EntrySummary } from "@/lib/rounds";

describe("day-on-day change", () => {
  it("shows nothing when there is no previous day", () => {
    expect(deltaView(5, null, "down")).toBeNull();
    expect(deltaView(5, undefined, "up")).toBeNull();
  });

  it("'down is good' metrics (pending, missed, LOW, shortfalls): fewer = green, more = red", () => {
    expect(deltaView(3, 7, "down")).toMatchObject({ text: "(▼ −4)", tone: "good" });
    expect(deltaView(9, 4, "down")).toMatchObject({ text: "(▲ +5)", tone: "bad" });
  });

  it("'up is good' metrics (entered): more = green, fewer = red", () => {
    expect(deltaView(12, 8, "up")).toMatchObject({ text: "(▲ +4)", tone: "good" });
    expect(deltaView(5, 8, "up")).toMatchObject({ text: "(▼ −3)", tone: "bad" });
  });

  it("no change is grey and says so; neutral metrics are never green or red", () => {
    expect(deltaView(6, 6, "down")).toMatchObject({ text: "(= 0)", tone: "flat" });
    expect(deltaView(10, 4, "neutral")).toMatchObject({ tone: "neutral" });
    expect(deltaView(1, 4, "neutral")).toMatchObject({ tone: "neutral" });
  });

  it("is readable without colour: arrow, sign and a spoken label", () => {
    const d = deltaView(9, 4, "down", "yesterday at this time")!;
    expect(d.text).toContain("▲");
    expect(d.text).toContain("+5");
    expect(d.label).toBe("Up 5 versus yesterday at this time, worse");
    expect(deltaView(3, 7, "down")!.label).toBe("Down 4 versus yesterday, better");
  });
});

describe("yesterday as of the same time", () => {
  const e = (round: string, at: string): EntrySummary => {
    const row = { id: round, round_id: round, planned: 10, actual: 9, adhoc_needed: 1, entered_by_email: "a@xpressbees.com", source: "link", reason_code: null, is_late: false, plan_changed: false, created_at: at } as EntryRow;
    return { first: row, latest: row, count: 1, planChanged: false };
  };

  it("ignores entries that were first made after the cut-off moment", () => {
    const all = new Map([
      ["early", e("early", "2026-10-09T05:00:00Z")],
      ["exact", e("exact", "2026-10-09T06:00:00Z")],
      ["late", e("late", "2026-10-09T06:00:01Z")],
    ]);
    const kept = entriesAsOf(all, new Date("2026-10-09T06:00:00Z"));
    expect([...kept.keys()].sort()).toEqual(["early", "exact"]);
  });
});
