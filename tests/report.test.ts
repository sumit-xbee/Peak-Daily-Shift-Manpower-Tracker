import { describe, expect, it } from "vitest";
import { buildConfig } from "@/lib/config";
import { poc3ReportEmail } from "@/lib/emails";
import { emailRows } from "@/lib/poc3report";
import { classify } from "@/lib/classify";
import { fmtPct, rankRows, reportTotals } from "@/lib/report";
import type { RoundView } from "@/lib/rounds";

const thresholds = buildConfig({}).thresholds;

// a minimal stand-in for a round, with or without an entry
function view(hub: string, label: string, planned: number | null, actual: number | null): RoundView {
  const entry = planned === null || actual === null ? null : { latest: { planned, actual, adhoc_needed: planned - actual } };
  return {
    shift: { hub: { name: hub, zone: { name: "North" } } },
    label,
    entry,
    cls: entry ? classify(planned as number, actual as number, thresholds) : null,
  } as unknown as RoundView;
}

describe("POC3 morning report: ranking", () => {
  const views = [
    view("A", "08:00-16:00", 100, 100), // 0%  OK
    view("B", "08:00-16:00", 200, 150), // 25% LOW (50 people)
    view("C", "08:00-16:00", 50, 44), // 12% LOW (6 people)
    view("D", "08:00-16:00", 100, 130), // -30% EXCESS
    view("E", "08:00-16:00", 80, 75), // 6.25% OK
    view("F", "08:00-16:00", null, null), // no entry
    view("G", "08:00-16:00", 0, 5), // nothing planned
  ];
  const rows = rankRows(views);

  it("ranks by gap % descending: worst shortfall first, excess last, no-plan then no-entry at the end", () => {
    expect(rows.map((r) => r.hub)).toEqual(["B", "C", "E", "A", "D", "G", "F"]);
  });

  it("flags exactly the shifts that were 10% or more below plan as LOW", () => {
    expect(rows.filter((r) => r.status === "LOW").map((r) => r.hub)).toEqual(["B", "C"]);
    expect(rows.find((r) => r.hub === "E")!.status).toBe("OK"); // 6.25% is below the 10% line
    expect(rows.find((r) => r.hub === "D")!.status).toBe("EXCESS");
    expect(rows.find((r) => r.hub === "F")!.status).toBe("NO_ENTRY");
  });

  it("totals: shifts, entered, LOW, people short", () => {
    expect(reportTotals(rows)).toEqual({ shifts: 7, entered: 6, noEntry: 1, low: 2, excess: 1, peopleShort: 56 });
  });

  it("formats gap %", () => {
    expect(fmtPct(25)).toBe("+25.0%");
    expect(fmtPct(-30)).toBe("−30.0%");
    expect(fmtPct(0)).toBe("0.0%");
    expect(fmtPct(null)).toBe("-");
  });
});

describe("POC3 morning report: email", () => {
  const rows = rankRows([view("B", "08:00-16:00", 200, 150), view("A", "14:00-22:00", 100, 100), view("F", "08:00-16:00", null, null)]);
  const t = reportTotals(rows);
  const { rows: er, hidden } = emailRows(rows);
  const mail = poc3ReportEmail({ name: "Asha", date: "2026-10-09", hubCount: 3, totals: t, rows: er, hiddenRows: hidden, dashboardUrl: "https://x.test/dashboard" });

  it("subject says how many shifts needed ad-hoc manpower", () => {
    expect(mail.subject).toBe("Yesterday's manpower report 2026-10-09: 1 shift needed ad-hoc manpower");
  });

  it("lists the worst hub first with its gap % and highlights the LOW row", () => {
    expect(mail.text.indexOf("B | 08:00-16:00")).toBeLessThan(mail.text.indexOf("A | 14:00-22:00"));
    expect(mail.text).toContain("+25.0%");
    expect(mail.html).toContain("background:#FDECEA");
  });

  it("says so when nothing needed ad-hoc manpower", () => {
    const ok = rankRows([view("A", "08:00-16:00", 100, 98)]);
    const m = poc3ReportEmail({ name: "x", date: "2026-10-09", hubCount: 1, totals: reportTotals(ok), rows: emailRows(ok).rows, hiddenRows: 0, dashboardUrl: "u" });
    expect(m.subject).toContain("no ad-hoc manpower needed");
  });

  it("a long list never hides the problems: LOW / EXCESS / no-entry always show, on-plan shifts fill the rest", () => {
    const many = [view("L1", "x", 100, 80), view("X1", "x", 100, 140), view("N1", "x", null, null), ...Array.from({ length: 100 }, (_, i) => view(`OK${i}`, "x", 100, 99))];
    const r = emailRows(rankRows(many), 10);
    expect(r.rows).toHaveLength(10);
    expect(r.hidden).toBe(103 - 10);
    expect(r.rows.some((x) => x.status === "LOW")).toBe(true);
    expect(r.rows.some((x) => x.status === "EXCESS")).toBe(true);
    expect(r.rows.some((x) => x.status === "NO ENTRY")).toBe(true);
    expect(r.rows[0].rank).toBe(1); // ranks keep their true position
  });
});
