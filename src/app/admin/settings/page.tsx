import SettingsForm from "@/components/SettingsForm";
import Shell from "@/components/Shell";
import { loadRawConfig } from "@/lib/config";
import { CONFIG_DEFS, showValue } from "@/lib/configdefs";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const raw = await loadRawConfig();
  const values = Object.fromEntries(CONFIG_DEFS.map((d) => [d.key, showValue(d, raw[d.key])]));
  const hubsRes = await db().from("hubs").select("id,name").order("name");
  const hubs = (hubsRes.data ?? []) as { id: string; name: string }[];
  const hubName = new Map(hubs.map((h) => [h.id, h.name]));
  const ov = await db().from("config_override").select("hub_id,key,value");
  const overrides = ((ov.data ?? []) as { hub_id: string; key: string; value: unknown }[]).map((o) => ({
    hubId: o.hub_id, hubName: hubName.get(o.hub_id) ?? "?", key: o.key, value: Array.isArray(o.value) ? o.value.join(", ") : String(o.value),
  }));
  const h = await db().from("config_history").select("key,hub_id,old_value,new_value,changed_by,changed_at").order("changed_at", { ascending: false }).limit(25);
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
