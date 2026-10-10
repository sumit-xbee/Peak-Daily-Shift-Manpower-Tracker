import { cached } from "./cache";
import { selectAll } from "./db";

export interface Person {
  id: string;
  name: string;
  email: string;
}
export interface Zone {
  id: string;
  name: string;
  rm: Person;
  hr: Person;
}
export interface Hub {
  id: string;
  name: string;
  zone: Zone;
  pocs: [Person, Person, Person];
  active: boolean;
}
export interface HubShift {
  id: string;
  hub: Hub;
  start: string; // "HH:MM:SS"
  end: string;
  active: boolean;
}
export interface Skip {
  hubId: string;
  hubShiftId: string | null;
  date: string;
}
export interface Master {
  people: Map<string, Person>;
  zones: Map<string, Zone>;
  hubs: Map<string, Hub>;
  shifts: Map<string, HubShift>;
  opsHeads: Person[];
  admins: Person[];
  skips: Skip[];
}

/** Load all master data (small: dozens of hubs, a few hundred shifts) in a handful of queries. */
export async function loadMaster(fresh = false): Promise<Master> {
  return cached("master", 60_000, loadMasterNow, fresh);
}

async function loadMasterNow(): Promise<Master> {
  const [people, zones, hubs, shifts, globals, skips] = await Promise.all([
    selectAll<Person>("people", "id,name,email"),
    selectAll<{ id: string; name: string; rm_person_id: string; hr_person_id: string }>("zones"),
    selectAll<{ id: string; name: string; zone_id: string; poc1_id: string; poc2_id: string; poc3_id: string; active: boolean }>("hubs"),
    selectAll<{ id: string; hub_id: string; start_time: string; end_time: string; active: boolean }>("hub_shifts"),
    selectAll<{ role: string; person_id: string }>("global_contacts", "role,person_id"),
    selectAll<{ hub_id: string; hub_shift_id: string | null; skip_date: string }>("skip_dates", "hub_id,hub_shift_id,skip_date"),
  ]);

  const peopleMap = new Map(people.map((p) => [p.id, p]));
  const P = (id: string): Person => {
    const p = peopleMap.get(id);
    if (!p) throw new Error(`master data: person ${id} is missing`);
    return p;
  };

  const zoneMap = new Map<string, Zone>();
  for (const z of zones) zoneMap.set(z.id, { id: z.id, name: z.name, rm: P(z.rm_person_id), hr: P(z.hr_person_id) });

  const hubMap = new Map<string, Hub>();
  for (const h of hubs) {
    const zone = zoneMap.get(h.zone_id);
    if (!zone) throw new Error(`master data: zone ${h.zone_id} is missing for hub ${h.name}`);
    hubMap.set(h.id, { id: h.id, name: h.name, zone, pocs: [P(h.poc1_id), P(h.poc2_id), P(h.poc3_id)], active: h.active });
  }

  const shiftMap = new Map<string, HubShift>();
  for (const s of shifts) {
    const hub = hubMap.get(s.hub_id);
    if (hub) shiftMap.set(s.id, { id: s.id, hub, start: s.start_time, end: s.end_time, active: s.active });
  }

  return {
    people: peopleMap,
    zones: zoneMap,
    hubs: hubMap,
    shifts: shiftMap,
    opsHeads: globals.filter((g) => g.role === "OPS_HEAD").map((g) => P(g.person_id)),
    admins: globals.filter((g) => g.role === "SYSTEM_ADMIN").map((g) => P(g.person_id)),
    skips: skips.map((s) => ({ hubId: s.hub_id, hubShiftId: s.hub_shift_id, date: s.skip_date })),
  };
}

export type RoleToken = "POC1" | "POC2" | "POC3" | "ZONE_HR" | "ZONE_RM" | "OPS_HEAD" | "SYSTEM_ADMIN";

/** Resolve role names to distinct people (de-duplicated by email) for one hub. */
export function recipientsFor(roles: string[], hub: Hub, m: Master): Person[] {
  const out: Person[] = [];
  const seen = new Set<string>();
  const add = (p?: Person) => {
    if (!p) return;
    const k = p.email.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  };
  for (const r of roles) {
    switch (r) {
      case "POC1": add(hub.pocs[0]); break;
      case "POC2": add(hub.pocs[1]); break;
      case "POC3": add(hub.pocs[2]); break;
      case "ZONE_HR": add(hub.zone.hr); break;
      case "ZONE_RM": add(hub.zone.rm); break;
      case "OPS_HEAD": m.opsHeads.forEach(add); break;
      case "SYSTEM_ADMIN": m.admins.forEach(add); break;
    }
  }
  return out;
}

export const isSkipped = (m: Master, hubId: string, hubShiftId: string, date: string) =>
  m.skips.some((s) => s.date === date && s.hubId === hubId && (s.hubShiftId === null || s.hubShiftId === hubShiftId));
