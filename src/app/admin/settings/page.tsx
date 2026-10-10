import SettingsForm from "@/components/SettingsForm";
import Shell from "@/components/Shell";
import { requireAdmin } from "@/lib/auth";
import { loadRawConfig } from "@/lib/config";
import { CONFIG_DEFAULTS, CONFIG_DEFS, showValue } from "@/lib/configdefs";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin(); // checked against the database BEFORE any admin data is read
  // all four reads at once (and fresh, so a saved change shows immediately)
  const [raw, hubsRes, ov, h] = await Promise.all([
    loadRawConfig(true),
    db().from("hubs").select("id,name").order("name"),
    db().from("config_override").select("hub_id,key,value"),
    db().from("config_history").select("key,hub_id,old_value,new_value,changed_by,changed_at").order("changed_at", { ascending: false }).limit(25),
  ]);
  // a setting that was added after the database was first set up shows its default until it is saved
  const values = Object.fromEntries(CONFIG_DEFS.map((d) => [d.key, showValue(d, raw[d.key] ?? CONFIG_DEFAULTS[d.key])]));
  const hubs = (hubsRes.data ?? []) as { id: string; name: string }[];
  const hubName = new Map(hubs.map((x) => [x.id, x.name]));
  const overrides = ((ov.data ?? []) as { hub_id: string; key: string; value: unknown }[]).map((o) => ({
    hubId: o.hub_id, hubName: hubName.get(o.hub_id) ?? "?", key: o.key, value: Array.isArray(o.value) ? o.value.join(", ") : String(o.value),
  }));
  const history = ((h.data ?? []) as { key: string; hub_id: string | null; old_value: unknown; new_value: unknown; changed_by: string | null; changed_at: string }[]).map((x) => ({
    at: fmtDateTime(x.changed_at), key: x.key, hub: x.hub_id ? hubName.get(x.hub_id) ?? "?" : null,
    oldV: x.old_value === null ? "" : JSON.stringify(x.old_value), newV: x.new_value === null ? "(removed)" : JSON.stringify(x.new_value), by: x.changed_by,
  }));

  return (
    <Shell active="/admin/settings" adminOnly>
      <h1>Settings</h1>
      <p className="muted">Every number that drives alerts, timings and recipients lives here. Changes apply to shifts that open after you save, and are logged below.</p>
      <SettingsForm values={values} hubs={hubs} overrides={overrides} history={history} />
    </Shell>
  );
}
