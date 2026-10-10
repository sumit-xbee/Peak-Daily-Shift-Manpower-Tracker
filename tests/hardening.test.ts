import { describe, expect, it } from "vitest";
import { baseEmail, isAllowedEmail } from "@/lib/config";
import { validateConfigValue, parseValue, CONFIG_DEFS } from "@/lib/configdefs";
import { leadingDigits } from "@/lib/client";
import { isDateStr } from "@/lib/time";
import { policyFor } from "@/lib/outbox";
import { cached, invalidateCaches } from "@/lib/cache";

const cfg = { allowedDomains: ["xpressbees.com", "xpressbees.in"] };

describe("email checks", () => {
  it("accepts normal XB addresses, including a +tag", () => {
    expect(isAllowedEmail("a.b@xpressbees.com", cfg)).toBe(true);
    expect(isAllowedEmail("A.B+x@XpressBees.IN", cfg)).toBe(true);
  });

  it("refuses anything that is not a plain mailbox at an allowed domain", () => {
    for (const bad of ["", "a@gmail.com", "a@mail.xpressbees.com", "a b@xpressbees.com", "a@xpressbees.com@evil.com", "<script>@xpressbees.com", "URGENT call 99999 now@xpressbees.com", "a\n@xpressbees.com"]) {
      expect(isAllowedEmail(bad, cfg), bad).toBe(false);
    }
  });

  it("refuses non-strings and giant values", () => {
    expect(isAllowedEmail(undefined, cfg)).toBe(false);
    expect(isAllowedEmail({ length: 5 }, cfg)).toBe(false);
    expect(isAllowedEmail("x".repeat(65) + "@xpressbees.com", cfg)).toBe(false); // local part over 64
    expect(isAllowedEmail("x".repeat(5000) + "@xpressbees.com", cfg)).toBe(false);
  });

  it("name+tag@ and name@ are the same mailbox for login limits", () => {
    expect(baseEmail("Victim+1@xpressbees.com")).toBe("victim@xpressbees.com");
    expect(baseEmail("victim+abc+def@xpressbees.in")).toBe("victim@xpressbees.in");
    expect(baseEmail("victim@xpressbees.com")).toBe("victim@xpressbees.com");
  });
});

describe("settings validation (the server uses the same rules as the form)", () => {
  it("only known settings can be written, and per-hub only the ones marked per-hub", () => {
    expect(validateConfigValue("app_base_url", "https://evil.test")).toBe("Unknown setting.");
    expect(validateConfigValue("enabled_since", "2020-01-01")).toBe("Unknown setting.");
    expect(validateConfigValue("digest_time_ist", "07:00", { hub: true })).toBe("This setting cannot be set per hub.");
    expect(validateConfigValue("low_pct", 12, { hub: true })).toBeNull();
  });

  it("numbers must be whole and inside a sensible range", () => {
    expect(validateConfigValue("low_pct", 10)).toBeNull();
    expect(validateConfigValue("low_pct", 0)).not.toBeNull();
    expect(validateConfigValue("low_pct", 5000)).not.toBeNull();
    expect(validateConfigValue("low_pct", 12.5)).not.toBeNull();
    expect(validateConfigValue("low_pct", "10")).not.toBeNull();
    expect(validateConfigValue("sanity_max_headcount", 0)).not.toBeNull();
    expect(validateConfigValue("cutoff_offset_min", 240)).toBeNull();
  });

  it("times, choices and domains are checked", () => {
    expect(validateConfigValue("poc3_report_time_ist", "06:00")).toBeNull();
    expect(validateConfigValue("poc3_report_time_ist", "7am")).not.toBeNull();
    expect(validateConfigValue("poc3_report_time_ist", "7:00")).not.toBeNull();
    expect(validateConfigValue("threshold_mode", "percent")).toBeNull();
    expect(validateConfigValue("threshold_mode", "Percent")).not.toBeNull();
    expect(validateConfigValue("allowed_email_domains", ["xpressbees.com", "xpressbees.in"])).toBeNull();
    expect(validateConfigValue("allowed_email_domains", ["@xpressbees.com"])).not.toBeNull();
    expect(validateConfigValue("allowed_email_domains", [])).not.toBeNull();
    expect(validateConfigValue("alert_recipients_low", ["ZONE_HR", "OPS_HEAD"])).toBeNull();
    expect(validateConfigValue("alert_recipients_low", ["EVERYONE"])).not.toBeNull();
    expect(validateConfigValue("alert_recipients_excess", [])).toBeNull(); // nobody: the current rule
    expect(validateConfigValue("first_email_to", [])).not.toBeNull(); // someone must get the first email
  });

  it("a test-mode address must be on an allowed XB domain", () => {
    const o = { allowedDomains: ["xpressbees.com"] };
    expect(validateConfigValue("dry_run_to", "me@xpressbees.com", o)).toBeNull();
    expect(validateConfigValue("dry_run_to", "attacker@evil.test", o)).not.toBeNull();
    expect(validateConfigValue("dry_run_to", "", o)).not.toBeNull();
    expect(validateConfigValue("reply_to", "", o)).toBeNull();
  });

  it("every setting in the form round-trips through the same validation", () => {
    for (const d of CONFIG_DEFS) {
      const sample = d.type === "int" ? "30" : d.type === "bool" ? "true" : d.type === "list" ? (d.key === "allowed_email_domains" ? "xpressbees.com" : d.key.startsWith("alert") || d.key === "first_email_to" ? "ZONE_HR" : "a@xpressbees.com") : d.type === "select" ? d.options![0] : d.key.includes("time") ? "06:00" : d.key === "dry_run_to" || d.key === "reply_to" ? "a@xpressbees.com" : "XB Tracker";
      expect(parseValue(d, sample).ok, `${d.key} with "${sample}"`).toBe(true);
    }
  });
});

describe("small helpers", () => {
  it("pasted decimals or signs never turn into a bigger number", () => {
    expect(leadingDigits("12.5")).toBe("12");
    expect(leadingDigits("-5")).toBe("");
    expect(leadingDigits("007")).toBe("007");
    expect(leadingDigits("abc")).toBe("");
    expect(leadingDigits("123456789")).toBe("12345");
  });

  it("only real calendar dates are accepted in the URL", () => {
    expect(isDateStr("2026-10-11")).toBe(true);
    expect(isDateStr("2026-02-29")).toBe(false);
    expect(isDateStr("2026-02-31")).toBe(false);
    expect(isDateStr("2026-13-01")).toBe(false);
    expect(isDateStr("2026-1-1")).toBe(false);
  });
});

describe("email delivery policy", () => {
  it("alerts keep retrying for a day; 'please enter' reminders expire quickly; unknown kinds get a safe default", () => {
    expect(policyFor("low_alert").maxAgeMin).toBe(24 * 60);
    expect(policyFor("reminder").maxAgeMin).toBeLessThanOrEqual(90);
    expect(policyFor("l3").maxAgeMin).toBeLessThanOrEqual(90);
    expect(policyFor("something_new").maxAgeMin).toBeGreaterThan(0);
    // an alert survives a ~30 minute outage with plenty of attempts to spare
    expect(policyFor("low_alert").maxAttempts).toBeGreaterThan(20);
  });
});

describe("cache", () => {
  it("serves a repeat from memory, and a clear forces a fresh load", async () => {
    invalidateCaches();
    let loads = 0;
    const load = async () => ++loads;
    expect(await cached("k", 60_000, load)).toBe(1);
    expect(await cached("k", 60_000, load)).toBe(1);
    invalidateCaches();
    expect(await cached("k", 60_000, load)).toBe(2);
    expect(await cached("k", 60_000, load, true)).toBe(3); // fresh = true always reloads
  });

  it("a load that was already running when the cache was cleared is not kept (it may be stale)", async () => {
    invalidateCaches();
    let release!: (v: number) => void;
    const slow = new Promise<number>((r) => (release = r));
    const first = cached("slow", 60_000, () => slow);
    invalidateCaches(); // an admin saved something while that load was in flight
    release(1);
    expect(await first).toBe(1);
    let loads = 0;
    expect(await cached("slow", 60_000, async () => ++loads + 10)).toBe(11); // loaded again, the stale value was dropped
  });

  it("two requests at the same moment share one load", async () => {
    invalidateCaches();
    let loads = 0;
    const load = async () => { await new Promise((r) => setTimeout(r, 20)); return ++loads; };
    const [a, b] = await Promise.all([cached("shared", 60_000, load), cached("shared", 60_000, load)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});
