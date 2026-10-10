import { describe, expect, it } from "vitest";
import { groupBy } from "@/lib/tick";
import type { Hub, Master, Person } from "@/lib/master";
import type { RoundView } from "@/lib/rounds";

const person = (n: string): Person => ({ id: n, name: n, email: `${n.toLowerCase()}@xpressbees.com` });
const [ASHA, BALA, CHITRA, DEV, ZHR, ZRM, OPS] = ["Asha", "Bala", "Chitra", "Dev", "ZHR", "ZRM", "OPS"].map(person);
const zone = { id: "z", name: "North", rm: ZRM, hr: ZHR };
const mkHub = (name: string, a: Person, b: Person, c: Person): Hub => ({ id: name, name, active: true, zone, pocs: [a, b, c] });
const master: Master = { people: new Map(), zones: new Map(), hubs: new Map(), shifts: new Map(), opsHeads: [OPS], admins: [], skips: [] };

// minimal stand-in for a round: only the fields grouping reads
const view = (hub: Hub, startIso: string) =>
  ({ round: { id: `${hub.name}-${startIso}` }, shift: { hub }, times: { shiftStart: new Date(startIso) } }) as unknown as RoundView;

const H1 = mkHub("H1", ASHA, BALA, CHITRA);
const H2 = mkHub("H2", ASHA, DEV, CHITRA);
const H3 = mkHub("H3", DEV, BALA, CHITRA);
const EIGHT = "2026-10-10T02:30:00Z";
const FOURTEEN = "2026-10-10T08:30:00Z";
const first = () => ["POC1", "POC2"];

describe("email grouping", () => {
  it("merges hubs with the SAME start time into one email per person", () => {
    const g = groupBy([view(H1, EIGHT), view(H2, EIGHT)], first, master);
    const asha = g.filter((x) => x.person.name === "Asha");
    expect(asha).toHaveLength(1);
    expect(asha[0].views.map((v) => v.shift.hub.name).sort()).toEqual(["H1", "H2"]);
  });

  it("never mixes different start times in one email", () => {
    const g = groupBy([view(H1, EIGHT), view(H2, FOURTEEN)], first, master);
    const asha = g.filter((x) => x.person.name === "Asha");
    expect(asha).toHaveLength(2);
    for (const x of asha) expect(x.views).toHaveLength(1);
  });

  it("a person is only told about hubs they are POC1/POC2 of", () => {
    const g = groupBy([view(H1, EIGHT), view(H2, EIGHT), view(H3, EIGHT)], first, master);
    const hubsOf = (n: string) => g.filter((x) => x.person.name === n).flatMap((x) => x.views.map((v) => v.shift.hub.name)).sort();
    expect(hubsOf("Asha")).toEqual(["H1", "H2"]);
    expect(hubsOf("Bala")).toEqual(["H1", "H3"]);
    expect(hubsOf("Dev")).toEqual(["H2", "H3"]);
    expect(hubsOf("Chitra")).toEqual([]); // POC3 is not in the first email
    expect(hubsOf("OPS")).toEqual([]);
  });

  it("POC3 receives only the hubs where they are POC3, per start time", () => {
    const g = groupBy([view(H1, EIGHT), view(H2, FOURTEEN)], () => ["POC3"], master);
    expect(g.filter((x) => x.person.name === "Chitra")).toHaveLength(2);
  });

  it("escalation to Ops head and Zone RM is also split by start time", () => {
    const g = groupBy([view(H1, EIGHT), view(H2, EIGHT), view(H3, FOURTEEN)], () => ["ZONE_RM", "OPS_HEAD"], master);
    expect(g.filter((x) => x.person.name === "OPS")).toHaveLength(2);
    expect(g.filter((x) => x.person.name === "ZRM")).toHaveLength(2);
  });

  it("one person in all three slots of a hub is emailed once", () => {
    const solo = mkHub("S", ASHA, ASHA, ASHA);
    const g = groupBy([view(solo, EIGHT)], first, master);
    expect(g).toHaveLength(1);
  });
});
