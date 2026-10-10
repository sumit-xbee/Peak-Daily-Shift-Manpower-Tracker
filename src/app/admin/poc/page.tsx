import PocDirectory, { type ChangeRow, type GlobalRow, type HubRow, type ZoneRow } from "@/components/PocDirectory";
import Shell from "@/components/Shell";
import { loadConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { loadMaster } from "@/lib/master";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function PocPage() {
  const [master, cfg] = await Promise.all([loadMaster(true), loadConfig(true)]);

  const shiftCount = new Map<string, number>();
  for (const s of master.shifts.values()) shiftCount.set(s.hub.id, (shiftCount.get(s.hub.id) ?? 0) + 1);

  const hubs: HubRow[] = [...master.hubs.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((h) => ({
      id: h.id, name: h.name, zoneId: h.zone.id, zone: h.zone.name, active: h.active, shifts: shiftCount.get(h.id) ?? 0,
      pocs: h.pocs.map((p) => ({ name: p.name, email: p.email })) as HubRow["pocs"],
    }));
  const hubCount = new Map<string, number>();
  for (const h of master.hubs.values()) hubCount.set(h.zone.id, (hubCount.get(h.zone.id) ?? 0) + 1);
  const zones: ZoneRow[] = [...master.zones.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((z) => ({ id: z.id, name: z.name, rm: { name: z.rm.name, email: z.rm.email }, hr: { name: z.hr.name, email: z.hr.email }, hubs: hubCount.get(z.id) ?? 0 }));
  const globals: GlobalRow[] = [
    ...master.opsHeads.map((p) => ({ role: "OPS_HEAD" as const, name: p.name, email: p.email })),
    ...master.admins.map((p) => ({ role: "SYSTEM_ADMIN" as const, name: p.name, email: p.email })),
  ];

  const a = await db().from("audit_log").select("at,actor_email,action,details").like("action", "poc_%").order("at", { ascending: false }).limit(15);
  const changes: ChangeRow[] = ((a.data ?? []) as { at: string; actor_email: string | null; action: string; details: Record<string, unknown> | null }[]).map((r) => ({
    at: fmtDateTime(r.at, cfg.tzOff),
    actor: r.actor_email ?? "",
    text:
      r.action === "poc_replace"
        ? `Replaced ${r.details?.from} with ${r.details?.to} (${r.details?.slots} slots, ${r.details?.hubs} hubs)`
        : r.action === "poc_set"
          ? `Set POCs for ${r.details?.hub}: ${(r.details?.emails as string[] | undefined)?.join(", ")}`
          : r.action,
  }));

  return (
    <Shell active="/admin/poc" adminOnly>
      <h1>POC directory</h1>
      <p className="muted">See and change who gets the emails for each hub. Anything marked &quot;placeholder&quot; is still to be assigned.</p>
      <PocDirectory hubs={hubs} zones={zones} globals={globals} placeholders={cfg.placeholderEmails} changes={changes} />
    </Shell>
  );
}
