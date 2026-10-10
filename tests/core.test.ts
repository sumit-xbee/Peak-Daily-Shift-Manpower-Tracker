import { describe, expect, it } from "vitest";
import { classify, adhocNeeded, gapPercent, DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/classify";
import { computeRoundTimes, dueSteps, roundStatus, type Offsets } from "@/lib/schedule";
import { addDays, fmtDateTime, localDateStr, localHM, localToUtc, shiftLabel } from "@/lib/time";
import { hashToken, newLoginCode, newToken } from "@/lib/tokens";

const OFF: Offsets = { roundOpen: 30, reminder: 60, l3: 60, rmOps: 120, cutoff: 240 };

describe("classify", () => {
  it("ad-hoc needed is planned minus actual", () => {
    expect(adhocNeeded(100, 85)).toBe(15);
    expect(adhocNeeded(100, 110)).toBe(-10);
  });

  it("management rule: LOW when actual is 10% or more below planned (default)", () => {
    expect(DEFAULT_THRESHOLDS.mode).toBe("percent");
    expect(classify(100, 90, DEFAULT_THRESHOLDS)).toBe("LOW"); // exactly 10% short
    expect(classify(100, 91, DEFAULT_THRESHOLDS)).toBe("OK"); // 9% short
    expect(classify(500, 449, DEFAULT_THRESHOLDS)).toBe("LOW"); // 10.2% short
    expect(classify(500, 451, DEFAULT_THRESHOLDS)).toBe("OK"); // 9.8% short
    expect(classify(20, 18, DEFAULT_THRESHOLDS)).toBe("LOW"); // a small hub: 2 of 20 is 10%
    expect(classify(20, 19, DEFAULT_THRESHOLDS)).toBe("OK");
  });

  it("EXCESS at 10% or more above planned (shown, never emailed)", () => {
    expect(classify(100, 110, DEFAULT_THRESHOLDS)).toBe("EXCESS");
    expect(classify(100, 109, DEFAULT_THRESHOLDS)).toBe("OK");
  });

  it("gap percent = (planned - actual) / planned", () => {
    expect(gapPercent(100, 85)).toBeCloseTo(15, 5);
    expect(gapPercent(200, 230)).toBeCloseTo(-15, 5);
    expect(gapPercent(50, 50)).toBe(0);
    expect(gapPercent(0, 7)).toBeNull();
  });

  it("headcount mode still works and honours changed thresholds", () => {
    const t: Thresholds = { ...DEFAULT_THRESHOLDS, mode: "absolute", low: 5, excess: 20 };
    expect(classify(50, 45, t)).toBe("LOW");
    expect(classify(50, 65, t)).toBe("OK");
    expect(classify(50, 70, t)).toBe("EXCESS");
    expect(classify(100, 90, { ...DEFAULT_THRESHOLDS, mode: "absolute" })).toBe("LOW");
    expect(classify(100, 91, { ...DEFAULT_THRESHOLDS, mode: "absolute" })).toBe("OK");
  });

  it("percent mode scales with planned", () => {
    const t: Thresholds = { ...DEFAULT_THRESHOLDS, mode: "percent", lowPct: 10, excessPct: 20 };
    expect(classify(500, 460, t)).toBe("OK"); // 40 short, limit 50
    expect(classify(500, 449, t)).toBe("LOW"); // 51 short
    expect(classify(20, 18, t)).toBe("LOW"); // 2 short, limit 2
    expect(classify(20, 24, t)).toBe("EXCESS"); // 4 above, limit 4
    expect(classify(20, 23, t)).toBe("OK");
  });

  it("percent mode with planned 0 falls back to absolute", () => {
    const t: Thresholds = { ...DEFAULT_THRESHOLDS, mode: "percent" };
    expect(classify(0, 10, t)).toBe("EXCESS");
    expect(classify(0, 5, t)).toBe("OK");
  });
});

describe("time (IST)", () => {
  it("08:00 IST is 02:30 UTC", () => {
    expect(localToUtc("2026-10-10", "08:00").toISOString()).toBe("2026-10-10T02:30:00.000Z");
  });

  it("an overnight shift starting 22:00 stays on its start date", () => {
    const start = localToUtc("2026-10-10", "22:00:00");
    expect(localDateStr(start)).toBe("2026-10-10");
    expect(localHM(start)).toBe("22:00");
  });

  it("local date rolls over at 18:30 UTC", () => {
    expect(localDateStr(new Date("2026-10-10T18:29:00Z"))).toBe("2026-10-10");
    expect(localDateStr(new Date("2026-10-10T18:30:00Z"))).toBe("2026-10-11");
  });

  it("addDays crosses month and year", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("formats labels", () => {
    expect(shiftLabel("08:00:00", "16:00:00")).toBe("08:00-16:00");
    expect(fmtDateTime(new Date("2026-10-10T03:00:00Z"))).toBe("10 Oct, 08:30");
  });
});

describe("round schedule", () => {
  const t = computeRoundTimes("2026-10-10", "08:00:00", OFF, 330);

  it("opens 30 min after the shift start, escalates at +60/+120, cuts off at +240", () => {
    expect(t.opensAt.toISOString()).toBe("2026-10-10T03:00:00.000Z"); // 08:30 IST
    expect(t.reminderAt.toISOString()).toBe("2026-10-10T04:00:00.000Z"); // 09:30 IST
    expect(t.rmOpsAt.toISOString()).toBe("2026-10-10T05:00:00.000Z"); // 10:30 IST
    expect(t.cutoffAt.toISOString()).toBe("2026-10-10T07:00:00.000Z"); // 12:30 IST
  });

  it("status moves NOT_DUE -> OPEN -> OVERDUE -> MISSED", () => {
    const base = { opensAt: t.opensAt, reminderAt: t.reminderAt, cutoffAt: t.cutoffAt };
    const at = (iso: string) => roundStatus({ ...base, now: new Date(iso) });
    expect(at("2026-10-10T02:59:00Z")).toBe("NOT_DUE");
    expect(at("2026-10-10T03:00:00Z")).toBe("OPEN");
    expect(at("2026-10-10T04:00:00Z")).toBe("OVERDUE");
    expect(at("2026-10-10T07:00:00Z")).toBe("MISSED");
  });

  it("an entry makes it SUBMITTED, or LATE if after cut-off", () => {
    const base = { now: new Date("2026-10-10T09:00:00Z"), opensAt: t.opensAt, reminderAt: t.reminderAt, cutoffAt: t.cutoffAt };
    expect(roundStatus({ ...base, firstEntryAt: new Date("2026-10-10T03:10:00Z") })).toBe("SUBMITTED");
    expect(roundStatus({ ...base, firstEntryAt: new Date("2026-10-10T08:00:00Z") })).toBe("LATE");
  });

  it("due steps follow the ladder and stop once an entry exists or at cut-off", () => {
    expect(dueSteps(new Date("2026-10-10T02:59:00Z"), t, false)).toEqual([]);
    expect(dueSteps(new Date("2026-10-10T03:00:00Z"), t, false)).toEqual(["open"]);
    expect(dueSteps(new Date("2026-10-10T04:00:00Z"), t, false)).toEqual(["open", "reminder", "l3"]);
    expect(dueSteps(new Date("2026-10-10T05:00:00Z"), t, false)).toEqual(["open", "reminder", "l3", "rm_ops"]);
    expect(dueSteps(new Date("2026-10-10T05:00:00Z"), t, true)).toEqual(["open"]);
    expect(dueSteps(new Date("2026-10-10T07:00:00Z"), t, false)).toEqual(["open"]);
  });

  it("an overnight 22:00 shift opens at 22:30 on the start date", () => {
    const n = computeRoundTimes("2026-10-10", "22:00", OFF, 330);
    expect(localHM(n.opensAt)).toBe("22:30");
    expect(localDateStr(n.opensAt)).toBe("2026-10-10");
    expect(localHM(n.cutoffAt)).toBe("02:30");
    expect(localDateStr(n.cutoffAt)).toBe("2026-10-11");
  });
});

describe("tokens", () => {
  it("are unique, long, URL-safe and hashed deterministically", () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
  });

  it("login codes are 6 digits", () => {
    for (let i = 0; i < 50; i++) expect(newLoginCode()).toMatch(/^\d{6}$/);
  });
});
