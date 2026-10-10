"use client";

import { useEffect, useState } from "react";
import { postJson } from "@/lib/client";

export default function AckForm({ token, allowedDomains }: { token: string; allowedDomains: string[] }) {
  const [email, setEmail] = useState("");
  const [eta, setEta] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      const e = localStorage.getItem("pst_email");
      if (e) setEmail(e);
    } catch { /* ignore */ }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    const res = await postJson("/api/ack", { token, email, eta, note });
    setBusy(false);
    if (res.ok) {
      try { localStorage.setItem("pst_email", email.trim().toLowerCase()); } catch { /* ignore */ }
      setDone(true);
    } else setErr(res.error);
  }

  if (done) return <div className="msg ok" role="status">✓ Acknowledged. Thank you. The Ops head and Zone RM can see this on the dashboard.</div>;

  return (
    <form onSubmit={submit} className="stack">
      <div className="field">
        <label htmlFor="ackemail">Your XB email</label>
        <input id="ackemail" type="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name@${allowedDomains[0]}`} />
      </div>
      <div className="field">
        <label htmlFor="eta">Action / ETA (required)</label>
        <input id="eta" type="text" required maxLength={200} value={eta} onChange={(e) => setEta(e.target.value)} placeholder="e.g. 12 people from vendor arriving by 11:30" />
      </div>
      <div className="field">
        <label htmlFor="note">Note (optional)</label>
        <textarea id="note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
      <button className="btn" disabled={busy}>{busy ? "Saving…" : "Acknowledge"}</button>
    </form>
  );
}
