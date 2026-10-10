"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client";

/** Gives emails that failed (for example during a Gmail outage) another chance. */
export default function RequeueButton({ failed }: { failed: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await postJson<{ ok?: boolean; error?: string; message?: string }>("/api/admin", { action: "requeueFailed" });
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? (res.data?.message ?? "Done.") : (res.error ?? "Failed.") });
    if (res.ok) router.refresh();
  }

  return (
    <div className="row" style={{ marginBottom: 12 }}>
      <button className="btn secondary" disabled={busy || failed === 0} onClick={go}>
        {busy ? "Working…" : `Re-send failed emails (${failed})`}
      </button>
      {msg && <span className="small" role="status" style={{ color: msg.ok ? "var(--ok)" : "var(--short)" }}>{msg.text}</span>}
    </div>
  );
}
