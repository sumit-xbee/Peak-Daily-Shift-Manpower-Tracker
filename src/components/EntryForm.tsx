"use client";

import { useEffect, useState } from "react";
import { classify, type Thresholds } from "@/lib/classify";

export interface EntryRowProps {
  roundId: string;
  hub: string;
  zone: string;
  label: string;
  cutoffText: string;
  planned: number | null;
  actual: number | null;
  hintPlan: number | null;
  thresholds: Thresholds;
  alreadyEntered: boolean;
}

interface Props {
  rows: EntryRowProps[];
  token?: string; // present on the emailed link
  canDelegate?: boolean;
  allowedDomains: string[];
  reasons: string[];
  sessionEmail?: string; // present on the dashboard
}

interface Saved { roundId: string; adhoc: number; cls: "LOW" | "EXCESS" | "OK"; unchanged: boolean }

const EMAIL_KEY = "pst_email";

export default function EntryForm({ rows, token, canDelegate, allowedDomains, reasons, sessionEmail }: Props) {
  const [vals, setVals] = useState<Record<string, { p: string; a: string; reason: string }>>(() =>
    Object.fromEntries(rows.map((r) => [r.roundId, { p: r.planned !== null ? String(r.planned) : "", a: r.actual !== null ? String(r.actual) : "", reason: "" }])),
  );
  const [email, setEmail] = useState(sessionEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [saved, setSaved] = useState<Record<string, Saved>>({});
  const [share, setShare] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (sessionEmail) return;
    try {
      const e = localStorage.getItem(EMAIL_KEY);
      if (e) setEmail(e);
    } catch { /* storage can be blocked; the field still works */ }
  }, [sessionEmail]);

  const set = (id: string, k: "p" | "a" | "reason", v: string) =>
    setVals((s) => ({ ...s, [id]: { ...s[id], [k]: k === "reason" ? v : v.replace(/\D/g, "").slice(0, 5) } }));

  const emailOk = (() => {
    const e = email.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+$/.test(e) && allowedDomains.includes(e.split("@")[1]);
  })();

  async function submit(confirm: boolean) {
    setErr(null);
    const items: { roundId: string; planned: number; actual: number; reason?: string }[] = [];
    for (const r of rows) {
      const v = vals[r.roundId];
      if (v.p === "" && v.a === "") continue;
      if (v.p === "" || v.a === "") {
        setErr(`${r.hub} ${r.label}: please fill both Planned and Actual.`);
        return;
      }
      items.push({ roundId: r.roundId, planned: Number(v.p), actual: Number(v.a), reason: v.reason || undefined });
    }
    if (!items.length) return setErr("Please enter the numbers first.");
    if (!sessionEmail && !emailOk) return setErr(`Please enter your XB email (${allowedDomains.map((d) => "@" + d).join(" or ")}).`);

    setBusy(true);
    try {
      const res = await fetch("/api/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email: sessionEmail ? undefined : email.trim(), items, confirm }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; needsConfirm?: boolean; warnings?: string[]; saved?: (Saved & { hub: string })[] };
      if (j.needsConfirm) {
        setWarnings(j.warnings ?? []);
      } else if (j.ok && j.saved) {
        setWarnings(null);
        setSaved(Object.fromEntries(j.saved.map((s) => [s.roundId, s])));
        if (!sessionEmail) {
          try { localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase()); } catch { /* ignore */ }
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setWarnings(null);
        setErr(j.error ?? "Could not save. Please try again.");
      }
    } catch {
      setErr("No connection. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function makeShare(roundId: string) {
    setErr(null);
    const res = await fetch("/api/delegate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, roundId, email: emailOk ? email.trim() : undefined }),
    });
    const j = (await res.json()) as { ok?: boolean; url?: string; error?: string };
    if (j.ok && j.url) setShare((s) => ({ ...s, [roundId]: j.url! }));
    else setErr(j.error ?? "Could not create the link.");
  }

  async function copy(roundId: string) {
    try {
      await navigator.clipboard.writeText(share[roundId]);
      setCopied(roundId);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setErr("Copy failed. Select the link and copy it by hand.");
    }
  }

  const anySaved = Object.keys(saved).length > 0;

  return (
    <div>
      {anySaved && (
        <div className="msg ok" role="status">
          ✓ Saved. {Object.values(saved).some((s) => s.cls === "LOW") ? "A LOW manpower alert has been sent to HR. " : ""}
          You can change the numbers below and save again until the cut-off.
        </div>
      )}
      {err && <div className="msg err" role="alert">{err}</div>}

      {!sessionEmail && (
        <div className="card">
          <label htmlFor="xbemail">Your XB email (asked once on this device)</label>
          <input id="xbemail" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name@${allowedDomains[0]}`} />
          {email && !emailOk && <div className="small" style={{ color: "var(--short)", marginTop: 4 }}>Use your {allowedDomains.map((d) => "@" + d).join(" or ")} address.</div>}
        </div>
      )}

      {rows.map((r) => {
        const v = vals[r.roundId];
        const p = v.p === "" ? null : Number(v.p);
        const a = v.a === "" ? null : Number(v.a);
        const need = p !== null && a !== null ? p - a : null;
        const cls = p !== null && a !== null ? classify(p, a, r.thresholds) : null;
        const s = saved[r.roundId];
        return (
          <div className="entry" key={r.roundId}>
            <div className="head">
              <div>
                <strong style={{ fontSize: 17 }}>{r.hub}</strong> <span className="muted">{r.zone}</span>
                <div className="muted small">Shift {r.label} · enter by {r.cutoffText}</div>
              </div>
              {(s || r.alreadyEntered) && <span className="chip okc">✓ {s ? "Saved" : "Already entered"}</span>}
            </div>
            <div className="nums">
              <div className="field">
                <label htmlFor={`p-${r.roundId}`}>Planned Manpower – Hub Processing</label>
                <input id={`p-${r.roundId}`} type="text" inputMode="numeric" autoComplete="off" value={v.p} onChange={(e) => set(r.roundId, "p", e.target.value)} placeholder="0" />
                {r.hintPlan !== null && v.p === "" && (
                  <button type="button" className="btn secondary small" style={{ marginTop: 6 }} onClick={() => set(r.roundId, "p", String(r.hintPlan))}>
                    Last time: {r.hintPlan} — use it
                  </button>
                )}
              </div>
              <div className="field">
                <label htmlFor={`a-${r.roundId}`}>Actual Manpower – Hub Processing</label>
                <input id={`a-${r.roundId}`} type="text" inputMode="numeric" autoComplete="off" value={v.a} onChange={(e) => set(r.roundId, "a", e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="live" aria-live="polite">
              <span className="muted">Ad-hoc manpower needed:</span>
              {need === null ? <strong>–</strong> : <strong className={`adhoc ${need > 0 ? "pos" : need < 0 ? "neg" : ""}`}>{need > 0 ? `+${need}` : need}</strong>}
              {cls === "LOW" && <span className="chip low">▼ LOW</span>}
              {cls === "EXCESS" && <span className="chip excess">▲ EXCESS</span>}
              {cls === "OK" && <span className="chip okc">✓ OK</span>}
            </div>
            {(cls === "LOW" || cls === "EXCESS") && (
              <div className="field" style={{ marginTop: 10 }}>
                <label htmlFor={`rs-${r.roundId}`}>Reason (optional)</label>
                <select id={`rs-${r.roundId}`} value={v.reason} onChange={(e) => set(r.roundId, "reason", e.target.value)}>
                  <option value="">Select a reason</option>
                  {reasons.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
            )}
            {canDelegate && token && (
              <div style={{ marginTop: 10 }}>
                {share[r.roundId] ? (
                  <div className="msg info">
                    <div className="small">Send this link to your shift in-charge. It works for this shift only:</div>
                    <input readOnly value={share[r.roundId]} onFocus={(e) => e.currentTarget.select()} aria-label="Link for shift in-charge" />
                    <button type="button" className="btn small" style={{ marginTop: 6 }} onClick={() => copy(r.roundId)}>{copied === r.roundId ? "Copied ✓" : "Copy link"}</button>
                  </div>
                ) : (
                  <button type="button" className="btn secondary small" onClick={() => makeShare(r.roundId)}>Share just this hub with shift in-charge</button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {warnings && (
        <div className="msg warn" role="alert">
          <strong>Please check before saving:</strong>
          <ul style={{ margin: "6px 0 8px 18px", padding: 0 }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          <div className="row">
            <button className="btn" onClick={() => submit(true)} disabled={busy}>Yes, save these numbers</button>
            <button className="btn secondary" onClick={() => setWarnings(null)}>Go back and change</button>
          </div>
        </div>
      )}

      {!warnings && (
        <button className="btn" style={{ width: "100%", fontSize: 17 }} onClick={() => submit(false)} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      )}
    </div>
  );
}
