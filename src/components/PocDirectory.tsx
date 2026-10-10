"use client";

import { useMemo, useState } from "react";

export interface P { name: string; email: string }
export interface HubRow { id: string; name: string; zoneId: string; zone: string; active: boolean; shifts: number; pocs: [P, P, P] }
export interface ZoneRow { id: string; name: string; rm: P; hr: P; hubs: number }
export interface GlobalRow { role: "OPS_HEAD" | "SYSTEM_ADMIN"; name: string; email: string }
export interface ChangeRow { at: string; actor: string; text: string }

async function post(body: unknown) {
  const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: "Failed." }))) as { ok: boolean; error?: string; message?: string };
}

const blank = (): P => ({ name: "", email: "" });
const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;

function PairInputs({ label, v, onChange }: { label: string; v: P; onChange: (p: P) => void }) {
  return (
    <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
      <div className="field" style={{ width: 70, paddingBottom: 12 }}><strong>{label}</strong></div>
      <div className="field" style={{ minWidth: 150, flex: 1 }}>
        <label>Name</label>
        <input type="text" value={v.name} onChange={(e) => onChange({ ...v, name: e.target.value })} />
      </div>
      <div className="field" style={{ minWidth: 220, flex: 1 }}>
        <label>XB email</label>
        <input type="email" value={v.email} onChange={(e) => onChange({ ...v, email: e.target.value })} />
      </div>
    </div>
  );
}

export default function PocDirectory({ hubs, zones, globals, placeholders, changes }: {
  hubs: HubRow[]; zones: ZoneRow[]; globals: GlobalRow[]; placeholders: string[]; changes: ChangeRow[];
}) {
  const [q, setQ] = useState("");
  const [zoneF, setZoneF] = useState("");
  const [phOnly, setPhOnly] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<[P, P, P]>([blank(), blank(), blank()]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // tools
  const [fromEmail, setFromEmail] = useState("");
  const [to, setTo] = useState<P>(blank());
  const [scope, setScope] = useState<"all" | "zone" | "hubs">("all");
  const [scopeZone, setScopeZone] = useState("");
  const [slots, setSlots] = useState<Record<1 | 2 | 3, boolean>>({ 1: true, 2: true, 3: true });
  const [bulk, setBulk] = useState<[P, P, P]>([blank(), blank(), blank()]);

  const isPh = (e: string) => placeholders.includes(e.toLowerCase());

  const people = useMemo(() => {
    const m = new Map<string, { name: string; email: string; slots: number }>();
    for (const h of hubs) for (const p of h.pocs) {
      const k = p.email.toLowerCase();
      const c = m.get(k) ?? { name: p.name, email: p.email, slots: 0 };
      c.slots++;
      m.set(k, c);
    }
    return [...m.values()].sort((a, b) => b.slots - a.slots || a.name.localeCompare(b.name));
  }, [hubs]);

  const shown = hubs.filter((h) => {
    if (zoneF && h.zone !== zoneF) return false;
    if (phOnly && !h.pocs.some((p) => isPh(p.email))) return false;
    if (q) {
      const s = q.toLowerCase();
      return h.name.toLowerCase().includes(s) || h.pocs.some((p) => p.name.toLowerCase().includes(s) || p.email.toLowerCase().includes(s));
    }
    return true;
  });
  const phCount = hubs.filter((h) => h.pocs.some((p) => isPh(p.email))).length;

  async function run(body: unknown, after?: () => void) {
    setBusy(true);
    setMsg(null);
    const r = await post(body);
    setBusy(false);
    if (r.ok) {
      setMsg({ kind: "ok", text: r.message ?? "Saved." });
      after?.();
      setTimeout(() => window.location.reload(), 900);
    } else setMsg({ kind: "err", text: r.error ?? "Failed." });
  }

  function startEdit(h: HubRow) {
    setEditing(h.id);
    setDraft([{ ...h.pocs[0] }, { ...h.pocs[1] }, { ...h.pocs[2] }]);
    setMsg(null);
  }

  function replaceCount(): number {
    const from = fromEmail.toLowerCase();
    const inScope = hubs.filter((h) => scope === "all" || (scope === "zone" ? h.zoneId === scopeZone : sel.has(h.id)));
    let n = 0;
    for (const h of inScope) h.pocs.forEach((p, i) => { if (p.email.toLowerCase() === from && slots[(i + 1) as 1 | 2 | 3]) n++; });
    return n;
  }

  function doReplace() {
    const n = replaceCount();
    if (!fromEmail) return setMsg({ kind: "err", text: "Choose the person to replace." });
    if (n === 0) return setMsg({ kind: "err", text: "That person is not in any of the chosen slots." });
    if (!window.confirm(`Replace ${fromEmail} with ${to.email || "(new person)"} in ${n} slot(s)?`)) return;
    run({
      action: "replacePerson", fromEmail, to, scope, zoneId: scope === "zone" ? scopeZone : undefined,
      hubIds: scope === "hubs" ? [...sel] : undefined, slots: ([1, 2, 3] as const).filter((s) => slots[s]),
    });
  }

  function download() {
    const head = ["Hub", "Zone", "POC1 Name", "POC1 Email", "POC2 Name", "POC2 Email", "POC3 Name", "POC3 Email", "Active"];
    const lines = [head.map(csv).join(",")];
    for (const h of hubs) lines.push([h.name, h.zone, ...h.pocs.flatMap((p) => [p.name, p.email]), h.active ? "Y" : "N"].map(csv).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "poc-directory.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}

      <section className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Hubs and POCs ({shown.length}{shown.length !== hubs.length ? ` of ${hubs.length}` : ""})</h2>
          <button className="btn secondary small" onClick={download}>Download CSV</button>
        </div>
        <div className="row" style={{ margin: "12px 0" }}>
          <input type="search" placeholder="Search hub, name or email" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} aria-label="Search" />
          <select value={zoneF} onChange={(e) => setZoneF(e.target.value)} style={{ maxWidth: 170 }} aria-label="Zone">
            <option value="">All zones</option>
            {zones.map((z) => <option key={z.id}>{z.name}</option>)}
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
            <input type="checkbox" checked={phOnly} onChange={(e) => setPhOnly(e.target.checked)} /> Only hubs with a placeholder ({phCount})
          </label>
          {sel.size > 0 && <span className="chip neutral">{sel.size} selected <button className="btn secondary small" style={{ minHeight: 22, padding: "0 8px" }} onClick={() => setSel(new Set())}>clear</button></span>}
        </div>

        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.every((h) => sel.has(h.id))} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...shown.map((h) => h.id)]) : new Set([...sel].filter((id) => !shown.some((h) => h.id === id))))} /></th>
                <th>Hub</th><th>Zone</th><th>POC1</th><th>POC2</th><th>POC3</th><th>Active</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map((h) =>
                editing === h.id ? (
                  <tr key={h.id}>
                    <td colSpan={8}>
                      <div className="stack" style={{ padding: "8px 0" }}>
                        <strong>{h.name}</strong> <span className="muted">({h.zone})</span>
                        {([0, 1, 2] as const).map((i) => (
                          <PairInputs key={i} label={`POC${i + 1}`} v={draft[i]} onChange={(p) => setDraft((d) => { const n = [...d] as [P, P, P]; n[i] = p; return n; })} />
                        ))}
                        <div className="row">
                          <button className="btn small" disabled={busy} onClick={() => run({ action: "setHubPocs", hubId: h.id, pocs: draft }, () => setEditing(null))}>Save</button>
                          <button className="btn secondary small" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={h.id}>
                    <td><input type="checkbox" aria-label={`Select ${h.name}`} checked={sel.has(h.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(h.id); else n.delete(h.id); return n; })} /></td>
                    <td><strong>{h.name}</strong><div className="small muted">{h.shifts} shift(s)</div></td>
                    <td>{h.zone}</td>
                    {h.pocs.map((p, i) => (
                      <td key={i} className="small">
                        {p.name} {isPh(p.email) && <span className="chip warnc">placeholder</span>}
                        <div className="muted">{p.email}</div>
                      </td>
                    ))}
                    <td>
                      <button className="btn secondary small" onClick={() => run({ action: "setHubActive", hubId: h.id, active: !h.active })}>{h.active ? "✓ Active" : "Off"}</button>
                    </td>
                    <td><button className="btn secondary small" onClick={() => startEdit(h)}>Edit</button></td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2>Replace a person everywhere</h2>
        <p className="muted small">The fastest way to move off a placeholder. Pick who to replace, who takes over, and where.</p>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ minWidth: 260 }}>
            <label htmlFor="rf">Replace</label>
            <select id="rf" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)}>
              <option value="">Choose a person…</option>
              {people.map((p) => <option key={p.email} value={p.email}>{p.name} ({p.email}) – {p.slots} slot(s){isPh(p.email) ? " – placeholder" : ""}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 160 }}>
            <label>New person: name</label>
            <input type="text" value={to.name} onChange={(e) => setTo({ ...to, name: e.target.value })} />
          </div>
          <div className="field" style={{ minWidth: 220 }}>
            <label>New person: XB email</label>
            <input type="email" value={to.email} onChange={(e) => setTo({ ...to, email: e.target.value })} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="sc">Where</label>
            <select id="sc" value={scope} onChange={(e) => setScope(e.target.value as "all" | "zone" | "hubs")}>
              <option value="all">Every hub</option>
              <option value="zone">One zone</option>
              <option value="hubs">Hubs I ticked above ({sel.size})</option>
            </select>
          </div>
          {scope === "zone" && (
            <div className="field">
              <label htmlFor="sz">Zone</label>
              <select id="sz" value={scopeZone} onChange={(e) => setScopeZone(e.target.value)}>
                <option value="">Choose…</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label>Slots</label>
            <div className="row" style={{ gap: 12 }}>
              {([1, 2, 3] as const).map((s) => (
                <label key={s} style={{ display: "flex", gap: 4, alignItems: "center", margin: 0, fontWeight: 400 }}>
                  <input type="checkbox" checked={slots[s]} onChange={(e) => setSlots((x) => ({ ...x, [s]: e.target.checked }))} /> POC{s}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div><button className="btn" disabled={busy} onClick={doReplace}>Replace{fromEmail ? ` (${replaceCount()} slots)` : ""}</button></div>
      </section>

      <section className="card stack">
        <h2>Give the ticked hubs the same POCs</h2>
        {([0, 1, 2] as const).map((i) => (
          <PairInputs key={i} label={`POC${i + 1}`} v={bulk[i]} onChange={(p) => setBulk((d) => { const n = [...d] as [P, P, P]; n[i] = p; return n; })} />
        ))}
        <div>
          <button className="btn" disabled={busy || sel.size === 0} onClick={() => window.confirm(`Set these POCs on ${sel.size} hub(s)?`) && run({ action: "bulkAssign", hubIds: [...sel], pocs: bulk })}>
            Assign to {sel.size} hub(s)
          </button>
        </div>
      </section>

      <ZonesAndGlobals zones={zones} globals={globals} run={run} busy={busy} />

      <section className="card">
        <h2>Recent POC changes</h2>
        {changes.length === 0 ? <p className="muted">No changes yet.</p> : (
          <table className="t"><tbody>{changes.map((c, i) => <tr key={i}><td className="small num" style={{ whiteSpace: "nowrap" }}>{c.at}</td><td className="small">{c.actor}</td><td className="small">{c.text}</td></tr>)}</tbody></table>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>A change applies to shifts that open after it. A shift already open keeps the people who were emailed.</p>
      </section>
    </div>
  );
}

function ZonesAndGlobals({ zones, globals, run, busy }: { zones: ZoneRow[]; globals: GlobalRow[]; run: (b: unknown, a?: () => void) => void; busy: boolean }) {
  const [ez, setEz] = useState<string | null>(null);
  const [rm, setRm] = useState<P>(blank());
  const [hr, setHr] = useState<P>(blank());
  const [role, setRole] = useState<"OPS_HEAD" | "SYSTEM_ADMIN">("OPS_HEAD");
  const [g, setG] = useState<P>(blank());
  return (
    <>
      <section className="card">
        <h2>Zone contacts</h2>
        <div className="tablewrap">
          <table className="t">
            <thead><tr><th>Zone</th><th>Zone RM</th><th>Zone HR</th><th>Hubs</th><th /></tr></thead>
            <tbody>
              {zones.map((z) =>
                ez === z.id ? (
                  <tr key={z.id}><td colSpan={5}>
                    <div className="stack" style={{ padding: "8px 0" }}>
                      <strong>{z.name}</strong>
                      <PairInputs label="RM" v={rm} onChange={setRm} />
                      <PairInputs label="HR" v={hr} onChange={setHr} />
                      <div className="row">
                        <button className="btn small" disabled={busy} onClick={() => run({ action: "setZoneContacts", zoneId: z.id, rm, hr }, () => setEz(null))}>Save</button>
                        <button className="btn secondary small" onClick={() => setEz(null)}>Cancel</button>
                      </div>
                    </div>
                  </td></tr>
                ) : (
                  <tr key={z.id}>
                    <td><strong>{z.name}</strong></td>
                    <td className="small">{z.rm.name}<div className="muted">{z.rm.email}</div></td>
                    <td className="small">{z.hr.name}<div className="muted">{z.hr.email}</div></td>
                    <td className="num">{z.hubs}</td>
                    <td><button className="btn secondary small" onClick={() => { setEz(z.id); setRm({ ...z.rm }); setHr({ ...z.hr }); }}>Edit</button></td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2>Ops head and system admins</h2>
        <table className="t">
          <tbody>
            {globals.map((x) => (
              <tr key={x.role + x.email}>
                <td><span className="chip neutral">{x.role}</span></td><td>{x.name}</td><td className="small">{x.email}</td>
                <td><button className="btn secondary small" disabled={busy} onClick={() => window.confirm(`Remove ${x.email} as ${x.role}?`) && run({ action: "setGlobalContact", role: x.role, person: { name: x.name, email: x.email }, remove: true })}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field">
            <label htmlFor="gr">Add</label>
            <select id="gr" value={role} onChange={(e) => setRole(e.target.value as "OPS_HEAD" | "SYSTEM_ADMIN")}>
              <option value="OPS_HEAD">OPS_HEAD</option><option value="SYSTEM_ADMIN">SYSTEM_ADMIN</option>
            </select>
          </div>
          <div className="field"><label>Name</label><input type="text" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></div>
          <div className="field"><label>XB email</label><input type="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} /></div>
          <button className="btn small" disabled={busy} onClick={() => run({ action: "setGlobalContact", role, person: g, remove: false }, () => setG(blank()))}>Add</button>
        </div>
      </section>
    </>
  );
}
