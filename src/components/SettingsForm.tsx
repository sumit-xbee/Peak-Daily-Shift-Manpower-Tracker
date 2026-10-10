"use client";

import { useState } from "react";
import { CONFIG_DEFS, OVERRIDE_KEYS, parseValue, type ConfigDef } from "@/lib/configdefs";

interface Override { hubId: string; hubName: string; key: string; value: string }
interface Hist { at: string; key: string; hub: string | null; oldV: string; newV: string; by: string | null }

async function post(body: unknown) {
  const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: "Failed." }))) as { ok: boolean; error?: string };
}

export default function SettingsForm({ values, hubs, overrides, history }: {
  values: Record<string, string>; hubs: { id: string; name: string }[]; overrides: Override[]; history: Hist[];
}) {
  const [vals, setVals] = useState(values);
  const [saved, setSaved] = useState<Record<string, "ok" | string>>({});
  const [ovHub, setOvHub] = useState("");
  const [ovKey, setOvKey] = useState(OVERRIDE_KEYS[0]);
  const [ovVal, setOvVal] = useState("");
  const [ovMsg, setOvMsg] = useState<string | null>(null);

  const groups = [...new Set(CONFIG_DEFS.map((d) => d.group))];

  async function save(def: ConfigDef) {
    const text = vals[def.key] ?? "";
    const p = parseValue(def, text);
    if (!p.ok) return setSaved((s) => ({ ...s, [def.key]: p.error }));
    if (def.key === "system_enabled" && text === "false" && !window.confirm("Switch the whole system OFF? No emails will be sent and no new rounds opened.")) return;
    if (def.key === "dry_run" && text === "false" && !window.confirm("Turn dry run OFF? Emails will go to the REAL recipients.")) return;
    const r = await post({ action: "setConfig", key: def.key, value: p.value });
    setSaved((s) => ({ ...s, [def.key]: r.ok ? "ok" : r.error ?? "Failed" }));
    if (r.ok) setTimeout(() => window.location.reload(), 600);
  }

  async function addOverride() {
    setOvMsg(null);
    const def = CONFIG_DEFS.find((d) => d.key === ovKey)!;
    const p = parseValue(def, ovVal);
    if (!ovHub) return setOvMsg("Choose a hub.");
    if (!p.ok) return setOvMsg(p.error);
    const r = await post({ action: "setConfig", key: ovKey, value: p.value, hubId: ovHub });
    if (r.ok) window.location.reload();
    else setOvMsg(r.error ?? "Failed");
  }

  async function clear(o: Override) {
    const r = await post({ action: "clearOverride", hubId: o.hubId, key: o.key });
    if (r.ok) window.location.reload();
  }

  return (
    <div>
      {groups.map((g) => (
        <section className="card" key={g}>
          <h2>{g}</h2>
          <div className="stack">
            {CONFIG_DEFS.filter((d) => d.group === g).map((d) => (
              <div key={d.key} className="row" style={{ alignItems: "flex-end" }}>
                <div className="field grow" style={{ minWidth: 240 }}>
                  <label htmlFor={`cfg-${d.key}`}>{d.label}</label>
                  {d.type === "bool" ? (
                    <select id={`cfg-${d.key}`} value={vals[d.key]} onChange={(e) => setVals((s) => ({ ...s, [d.key]: e.target.value }))}>
                      <option value="true">Yes / ON</option>
                      <option value="false">No / OFF</option>
                    </select>
                  ) : d.type === "select" ? (
                    <select id={`cfg-${d.key}`} value={vals[d.key]} onChange={(e) => setVals((s) => ({ ...s, [d.key]: e.target.value }))}>
                      {d.options!.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input id={`cfg-${d.key}`} type="text" value={vals[d.key] ?? ""} onChange={(e) => setVals((s) => ({ ...s, [d.key]: e.target.value }))} inputMode={d.type === "int" ? "numeric" : undefined} />
                  )}
                  {d.help && <div className="small muted" style={{ marginTop: 3 }}>{d.help}</div>}
                </div>
                <div>
                  <button className="btn small" onClick={() => save(d)}>Save</button>
                </div>
                <div className="small" style={{ minWidth: 90 }} aria-live="polite">
                  {saved[d.key] === "ok" ? <span style={{ color: "var(--ok)" }}>✓ Saved</span> : saved[d.key] ? <span style={{ color: "var(--short)" }}>{saved[d.key]}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="card">
        <h2>Per-hub overrides</h2>
        <p className="muted small">Use a different threshold or timing for one hub (for example a very large hub). The hub then ignores the global value for that setting.</p>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ minWidth: 180 }}>
            <label htmlFor="ovh">Hub</label>
            <select id="ovh" value={ovHub} onChange={(e) => setOvHub(e.target.value)}>
              <option value="">Choose…</option>
              {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="ovk">Setting</label>
            <select id="ovk" value={ovKey} onChange={(e) => setOvKey(e.target.value)}>
              {OVERRIDE_KEYS.map((k) => <option key={k} value={k}>{CONFIG_DEFS.find((d) => d.key === k)!.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 120 }}>
            <label htmlFor="ovv">Value</label>
            <input id="ovv" type="text" value={ovVal} onChange={(e) => setOvVal(e.target.value)} />
          </div>
          <button className="btn small" onClick={addOverride}>Add override</button>
        </div>
        {ovMsg && <div className="msg err">{ovMsg}</div>}
        {overrides.length > 0 && (
          <div className="tablewrap" style={{ marginTop: 12 }}>
            <table className="t">
              <thead><tr><th>Hub</th><th>Setting</th><th>Value</th><th /></tr></thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.hubId + o.key}>
                    <td>{o.hubName}</td><td>{CONFIG_DEFS.find((d) => d.key === o.key)?.label ?? o.key}</td><td className="num">{o.value}</td>
                    <td><button className="btn secondary small" onClick={() => clear(o)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Recent changes</h2>
        <div className="tablewrap">
          <table className="t">
            <thead><tr><th>When</th><th>Setting</th><th>Hub</th><th>Old</th><th>New</th><th>By</th></tr></thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={6} className="muted">No changes yet.</td></tr>}
              {history.map((h, i) => (
                <tr key={i}><td className="small num">{h.at}</td><td>{h.key}</td><td>{h.hub ?? "all"}</td><td className="small">{h.oldV}</td><td className="small">{h.newV}</td><td className="small">{h.by}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
