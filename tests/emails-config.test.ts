import { describe, expect, it } from "vitest";
import { buildConfig, isAllowedEmail } from "@/lib/config";
import { CONFIG_DEFS, parseValue } from "@/lib/configdefs";
import { digestEmail, esc, excessAlertEmail, lowAlertEmail, openEmail, resolvedEmail } from "@/lib/emails";
import { recipientsFor, type Hub, type Master, type Person } from "@/lib/master";

const person = (n: string, e: string): Person => ({ id: n, name: n, email: e });
const A = person("Asha", "asha@xpressbees.com");
const B = person("Bala", "bala@xpressbees.in");
const HR = person("Zone HR", "hr@xpressbees.com");
const RM = person("Zone RM", "rm@xpressbees.com");
const OPS = person("Ops Head", "ops@xpressbees.com");

const hub = (p1: Person, p2: Person, p3: Person): Hub => ({
  id: "h1", name: "DEL/PC2", active: true, pocs: [p1, p2, p3],
  zone: { id: "z1", name: "North", rm: RM, hr: HR },
});
const master: Master = { people: new Map(), zones: new Map(), hubs: new Map(), shifts: new Map(), opsHeads: [OPS], admins: [], skips: [] };

describe("config", () => {
  it("falls back to safe defaults for an empty config", () => {
    const c = buildConfig({});
    expect(c.thresholds).toMatchObject({ mode: "percent", lowPct: 10, excessPct: 10, low: 10, excess: 10 });
    expect(c.alertRecipientsExcess).toEqual([]); // excess is never emailed
    expect(c.alertRecipientsLow).toEqual(["ZONE_HR", "OPS_HEAD", "ZONE_RM"]);
    expect(c.poc3ReportEnabled).toBe(true);
    expect(c.poc3ReportTimeIst).toBe("06:00");
    expect(c.offsets).toEqual({ roundOpen: 30, reminder: 60, l3: 60, rmOps: 120, cutoff: 240 });
    expect(c.dryRun).toBe(true); // never emails real people by accident
    expect(c.firstEmailTo).toEqual(["POC1", "POC2"]);
    expect(c.allowedDomains).toEqual(["xpressbees.com", "xpressbees.in"]);
  });

  it("reads changed numbers from the config table", () => {
    const c = buildConfig({ low_threshold: 5, excess_threshold: 15, cutoff_offset_min: 180, dry_run: false, threshold_mode: "absolute", low_pct: 12, status_board_scope: "all" });
    expect(c.thresholds).toMatchObject({ low: 5, excess: 15, mode: "absolute", lowPct: 12 });
    expect(c.offsets.cutoff).toBe(180);
    expect(c.dryRun).toBe(false);
    expect(c.statusBoardScope).toBe("all");
  });

  it("ignores junk values instead of crashing", () => {
    const c = buildConfig({ low_threshold: "ten", reminder_offset_min: null, allowed_email_domains: "xpressbees.com" });
    expect(c.thresholds.low).toBe(10);
    expect(c.offsets.reminder).toBe(60);
    expect(c.allowedDomains).toEqual(["xpressbees.com", "xpressbees.in"]);
  });

  it("accepts .com and .in XB emails only", () => {
    const c = buildConfig({});
    expect(isAllowedEmail("a@xpressbees.com", c)).toBe(true);
    expect(isAllowedEmail("A@XpressBees.IN", c)).toBe(true);
    expect(isAllowedEmail("a@gmail.com", c)).toBe(false);
    expect(isAllowedEmail("a@mail.xpressbees.com", c)).toBe(false);
    expect(isAllowedEmail("a b@xpressbees.com", c)).toBe(false);
    expect(isAllowedEmail("a@xpressbees.com@evil.com", c)).toBe(false);
    expect(isAllowedEmail("", c)).toBe(false);
  });

  it("every settings definition has a parser that round-trips", () => {
    for (const d of CONFIG_DEFS) {
      const sample = d.type === "int" ? "12" : d.type === "bool" ? "true" : d.type === "list" ? "a, b" : d.options?.[0] ?? "x";
      const r = parseValue(d, sample);
      expect(r.ok, d.key).toBe(true);
    }
    expect(parseValue(CONFIG_DEFS.find((d) => d.type === "int")!, "abc").ok).toBe(false);
  });
});

describe("recipients", () => {
  it("one person in all three POC slots is emailed once", () => {
    const h = hub(A, A, A);
    expect(recipientsFor(["POC1", "POC2"], h, master)).toHaveLength(1);
    expect(recipientsFor(["POC1", "POC2", "POC3"], h, master)).toHaveLength(1);
  });

  it("distinct POCs are each emailed; case differences do not duplicate", () => {
    expect(recipientsFor(["POC1", "POC2"], hub(A, B, A), master).map((p) => p.name)).toEqual(["Asha", "Bala"]);
    const upper = person("Asha again", "ASHA@xpressbees.com");
    expect(recipientsFor(["POC1", "POC2"], hub(A, upper, B), master)).toHaveLength(1);
  });

  it("LOW alert reaches Zone HR, Ops head and Zone RM, once each", () => {
    const got = recipientsFor(["ZONE_HR", "OPS_HEAD", "ZONE_RM"], hub(A, B, A), master).map((p) => p.name);
    expect(got).toEqual(["Zone HR", "Ops Head", "Zone RM"]);
  });
});

describe("emails", () => {
  const round = { hub: "DEL/PC2", zone: "North", label: "08:00-16:00", opensAt: new Date("2026-10-10T03:00:00Z"), cutoffAt: new Date("2026-10-10T07:00:00Z") };

  it("round-open email has one button, the shift and a plain-text twin", () => {
    const m = openEmail({ name: "Asha", items: [round], url: "https://x.test/e/abc", off: 330 });
    expect(m.subject).toBe("ACTION: Enter manpower - DEL/PC2 08:00-16:00");
    expect(m.html).toContain("https://x.test/e/abc");
    expect((m.html.match(/<a /g) ?? []).length).toBe(1);
    expect(m.html).toContain("Enter manpower");
    expect(m.text).toContain("https://x.test/e/abc");
    expect(m.html).toContain("17:00".slice(0, 0) + "by 12:30");
  });

  it("several shifts are summarised in the subject", () => {
    const m = openEmail({ name: "Asha", items: [round, { ...round, hub: "BLR/FC1" }, { ...round, hub: "PNQ/CHK" }], url: "u", off: 330 });
    expect(m.subject).toBe("ACTION: Enter manpower - 3 shifts (DEL/PC2 +2 more)");
  });

  it("LOW alert shows planned, actual and shortfall, and an acknowledge button for HR", () => {
    const a = { hub: "DEL/PC2", zone: "North", label: "08:00-16:00", planned: 120, actual: 104, need: 16, enteredBy: "a@xpressbees.com", enteredAt: new Date("2026-10-10T03:10:00Z"), off: 330 };
    const m = lowAlertEmail({ name: "HR", a, ackUrl: "https://x.test/ack/t", dashboardUrl: "https://x.test/dashboard" });
    expect(m.subject).toBe("LOW MANPOWER: DEL/PC2 08:00-16:00 short by 16");
    expect(m.html).toContain("Acknowledge and give ETA");
    expect(m.html).toContain(">120<");
    expect(m.html).toContain(">104<");
    expect(m.html).toContain(">16<");
    const noAck = lowAlertEmail({ name: "Ops", a, dashboardUrl: "https://x.test/dashboard" });
    expect(noAck.html).toContain("Open dashboard");
    expect(noAck.html).not.toContain("Acknowledge and give ETA");
  });

  it("EXCESS and resolved emails read correctly", () => {
    const a = { hub: "H", zone: "Z", label: "08:00-16:00", planned: 100, actual: 112, need: -12, enteredBy: "a@xpressbees.com", enteredAt: new Date(), off: 330 };
    expect(excessAlertEmail({ name: "x", a, dashboardUrl: "u" }).subject).toBe("EXCESS MANPOWER: H 08:00-16:00 +12 above plan");
    expect(resolvedEmail({ name: "x", a, was: "LOW", dashboardUrl: "u" }).subject).toContain("back within limits");
  });

  it("escapes anything typed by people (no HTML injection)", () => {
    expect(esc(`<script>alert("x")</script>&'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;");
    const evil = { ...round, hub: `<img src=x onerror=alert(1)>` };
    const m = openEmail({ name: `<b>Bob</b>`, items: [evil], url: "https://x.test/e/a", off: 330 });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).not.toContain("<b>Bob</b>");
  });

  it("digest lists exceptions and totals", () => {
    const m = digestEmail({
      name: "Ops", date: "2026-10-09", dashboardUrl: "u",
      zones: [{ zone: "North", total: 10, submitted: 7, late: 1, missed: 2, low: [{ hub: "A", label: "08:00-16:00", need: 12 }], excess: [], unacked: [], missedList: [{ hub: "B", label: "14:00-22:00" }] }],
    });
    expect(m.subject).toBe("Daily manpower digest - 2026-10-09");
    expect(m.text).toContain("MISSED - North: B 14:00-22:00");
    expect(m.text).toContain("LOW - North: A 08:00-16:00 short by 12");
  });
});
