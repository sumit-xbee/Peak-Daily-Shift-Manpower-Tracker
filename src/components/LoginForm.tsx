"use client";

import { useState } from "react";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);

  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json().catch(() => ({ ok: false, error: "Something went wrong." }))) as { ok: boolean; error?: string };
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const j = await post("/api/auth/request", { email });
    setBusy(false);
    if (j.ok) {
      setStep("code");
      setMsg({ kind: "ok", text: "Code sent. Check your inbox (and spam folder)." });
    } else setMsg({ kind: "err", text: j.error ?? "Could not send the code." });
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const j = await post("/api/auth/verify", { email, code });
    if (j.ok) {
      window.location.href = "/dashboard";
      return;
    }
    setBusy(false);
    setMsg({ kind: "err", text: j.error ?? "Wrong code." });
  }

  return (
    <form onSubmit={step === "email" ? sendCode : verify} className="stack">
      <div className="field">
        <label htmlFor="email">XB email</label>
        <input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={step === "code"} placeholder="name@xpressbees.com" />
      </div>
      {step === "code" && (
        <div className="field">
          <label htmlFor="code">6-digit code</label>
          <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
        </div>
      )}
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
      <div className="row">
        <button className="btn" disabled={busy}>{busy ? "Please wait…" : step === "email" ? "Email me a code" : "Log in"}</button>
        {step === "code" && (
          <button type="button" className="btn secondary" onClick={() => { setStep("email"); setCode(""); setMsg(null); }}>Use a different email</button>
        )}
      </div>
    </form>
  );
}
