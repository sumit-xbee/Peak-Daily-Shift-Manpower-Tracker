"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { classify, type Thresholds } from "@/lib/classify";
import { leadingDigits, postJson } from "@/lib/client";

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
  /** OPEN | OVERDUE | MISSED | SUBMITTED | LATE | NOT_DUE */
  status: string;
}

interface Props {
  rows: EntryRowProps[];
  token?: string; // present on the emailed link
  canDelegate?: boolean;
  allowedDomains: string[];
  reasons: string[];
  sessionEmail?: string; // present on the dashboard
}

interface Saved { p: string; a: string; cls: "LOW" | "EXCESS" | "OK" }
type SaveResponse = { ok?: boolean; error?: string; needsConfirm?: boolean; warnings?: string[]; saved?: { roundId: string; cls: "LOW" | "EXCESS" | "OK" }[] };

const EMAIL_KEY = "pst_email";

export default function EntryForm({ rows, token, canDelegate, allowedDomains, reasons, sessionEmail }: Props) {
  const router = useRouter();
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

  // Any change to a number or reason withdraws a pending "please check" box: it was about the OLD numbers,
  // and "Yes, save" must never save something the person has not been warned about.
  const set = (id: string, k: "p" | "a" | "reason", v: string) => {
    setWarnings(null);
    setVals((s) => ({ ...s, [id]: k === "reason" ? { ...s[id], reason: v } : { ...s[id], [k]: leadingDigits(v), reason: "" } }));
  };

  const emailOk = (() => {
    const e = email.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+$/.test(e) && e.length <= 254 && allowedDomains.includes(e.split("@")[1]);
  })();

  async function submit(confirm: boolean) {
    if (busy) return;
    setErr(null);
    const items: { roundId: string; planned: number; actual: number; reason?: string }[] = [];
    const sent: Record<string, Saved> = {};
    for (const r of rows) {
      const v = vals[r.roundId];
      if (v.p === "" && v.a === "") continue;
      if (v.p === "" || v.a === "") {
        setErr(`${r.hub} ${r.label}: please fill both Planned and Actual.`);
        return;
      }
      const cls = classify(Number(v.p), Number(v.a), r.thresholds);
      items.push({ roundId: r.roundId, planned: Number(v.p), actual: Number(v.a), reason: cls !== "OK" && v.reason ? v.reason : undefined });
      sent[r.roundId] = { p: v.p, a: v.a, cls };
    }
    if (!items.length) return setErr("Please enter the numbers first.");
    if (!sessionEmail && !emailOk) return setErr(`Please enter your XB email (${allowedDomains.map((d) => "@" + d).join(" or ")}).`);

    setBusy(true);
    const res = await postJson<SaveResponse>("/api/entry", { token, email: sessionEmail ? undefined : email.trim(), items, confirm });
    setBusy(false);
    const j = res.data;
    if (j?.needsConfirm) {
      setWarnings(j.warnings ?? []);
    } else if (res.ok && j?.saved) {
      setWarnings(null);
      setSaved((s) => ({ ...s, ...Object.fromEntries(j.saved!.map((x) => [x.roundId, { ...sent[x.roundId], cls: x.cls }])) }));
      if (!sessionEmail) {
        try { localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase()); } catch { /* ignore */ }
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      router.refresh(); // the "who has entered" board below updates; what has been typed stays
    } else {
      setWarnings(null);
      setErr(res.error);
    }
  }

  async function makeShare(roundId: string) {
    setErr(null);
    const res = await postJson<{ ok?: boolean; url?: string; error?: string }>("/api/delegate", { token, roundId, email: emailOk ? email.trim() : undefined });
    if (res.ok && res.data?.url) setShare((s) => ({ ...s, [roundId]: res.data!.url! }));
    else setErr(res.error);
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

  const anySaved = Object.values(saved).length > 0;

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
        // "Saved" only while the boxes still hold what was saved
        const isSaved = Boolean(s && s.p === v.p && s.a === v.a);
        return (
          <div className="entry" key={r.roundId}>
            <div className="head">
              <div>
                <strong style={{ fontSize: 17 }}>{r.hub}</strong> <span className="muted">{r.zone}</span>
                <div className="muted small">Shift {r.label} · enter by {r.cutoffText}</div>
              </div>
              {(isSaved || (!s && r.alreadyEntered)) && <span className="chip okc">✓ {isSaved ? "Saved" : "Already entered"}</span>}
            </div>
            <div className="nums">
              <div className="field">
                <label htmlFor={`p-${r.roundId}`}>Planned Manpower – Hub Processing</label>
                <input id={`p-${r.roundId}`} type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={v.p} disabled={busy} onChange={(e) => set(r.roundId, "p", e.target.value)} placeholder="0" />
                {r.hintPlan !== null && v.p === "" && (
                  <button type="button" className="btn secondary small" style={{ marginTop: 6 }} onClick={() => set(r.roundId, "p", String(r.hintPlan))}>
                    Last time: {r.hintPlan} — use it
                  </button>
                )}
              </div>
              <div className="field">
                <label htmlFor={`a-${r.roundId}`}>Actual Manpower – Hub Processing</label>
                <input id={`a-${r.roundId}`} type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={v.a} disabled={busy} onChange={(e) => set(r.roundId, "a", e.target.value)} placeholder="0" />
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
                <select id={`rs-${r.roundId}`} value={v.reason} disabled={busy} onChange={(e) => set(r.roundId, "reason", e.target.value)}>
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
