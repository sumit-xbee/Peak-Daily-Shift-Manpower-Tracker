"use client";

import { useState } from "react";
import { classify } from "@/lib/classify";
import { leadingDigits, postJson } from "@/lib/client";
import type { EntryRowProps } from "./EntryForm";

interface Props {
  rows: EntryRowProps[];
  reasons: string[];
}

interface RowState {
  p: string;
  a: string;
  reason: string;
  busy: boolean;
  err: string | null;
  warnings: string[] | null;
  /** what was actually saved, so "Saved" can never describe numbers that were typed afterwards */
  saved: { p: string; a: string; adhoc: number; cls: "LOW" | "EXCESS" | "OK" } | null;
}

const STATUS_CHIP: Record<string, { cls: string; text: string }> = {
  OPEN: { cls: "warnc", text: "● Pending" },
  OVERDUE: { cls: "low", text: "! Overdue" },
  MISSED: { cls: "low", text: "✕ Missed" },
  SUBMITTED: { cls: "okc", text: "✓ Entered" },
  LATE: { cls: "warnc", text: "✓ Entered late" },
  NOT_DUE: { cls: "neutral", text: "◷ Not due" },
};

const blank = (r: EntryRowProps): RowState => ({
  p: r.planned !== null ? String(r.planned) : "", a: r.actual !== null ? String(r.actual) : "", reason: "", busy: false, err: null, warnings: null, saved: null,
});

/**
 * One line per shift with its own Save button right beside the numbers, so the person can type,
 * save and move on without scrolling to a button at the bottom. Enter in either box also saves.
 * The parent gives this component a `key` that changes with the date and zone, so a new list starts fresh.
 */
export default function MissingRows({ rows, reasons }: Props) {
  const [st, setSt] = useState<Record<string, RowState>>(() => Object.fromEntries(rows.map((r) => [r.roundId, blank(r)])));
  const patch = (id: string, v: Partial<RowState>) => setSt((s) => ({ ...s, [id]: { ...(s[id] ?? { p: "", a: "", reason: "", busy: false, err: null, warnings: null, saved: null }), ...v } }));
  const savedCount = Object.values(st).filter((s) => s.saved).length;

  async function save(r: EntryRowProps, confirm: boolean) {
    const s = st[r.roundId] ?? blank(r);
    if (s.busy) return;
    if (s.p === "" || s.a === "") return patch(r.roundId, { err: "Fill both Planned and Actual.", warnings: null });
    const sent = { p: s.p, a: s.a };
    const cls = classify(Number(sent.p), Number(sent.a), r.thresholds);
    patch(r.roundId, { busy: true, err: null });
    const res = await postJson<{ ok?: boolean; error?: string; needsConfirm?: boolean; warnings?: string[]; saved?: { adhoc: number; cls: "LOW" | "EXCESS" | "OK" }[] }>("/api/entry", {
      items: [{ roundId: r.roundId, planned: Number(sent.p), actual: Number(sent.a), reason: cls !== "OK" && s.reason ? s.reason : undefined }],
      confirm,
    });
    const j = res.data;
    if (j?.needsConfirm) patch(r.roundId, { busy: false, warnings: j.warnings ?? [] });
    else if (res.ok && j?.saved?.[0]) patch(r.roundId, { busy: false, warnings: null, err: null, saved: { p: sent.p, a: sent.a, adhoc: j.saved[0].adhoc, cls: j.saved[0].cls } });
    else patch(r.roundId, { busy: false, warnings: null, err: res.error });
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="small muted">{rows.length} shift(s) listed</span>
        <span className="small" aria-live="polite">{savedCount > 0 ? <span className="chip okc">✓ {savedCount} saved just now</span> : null}</span>
      </div>

      {rows.map((r) => {
        const s = st[r.roundId] ?? blank(r);
        const p = s.p === "" ? null : Number(s.p);
        const a = s.a === "" ? null : Number(s.a);
        const need = p !== null && a !== null ? p - a : null;
        const cls = p !== null && a !== null ? classify(p, a, r.thresholds) : null;
        const chip = STATUS_CHIP[r.status] ?? STATUS_CHIP.OPEN;
        // "saved" only while the boxes still hold what was saved
        const isSaved = Boolean(s.saved && s.saved.p === s.p && s.saved.a === s.a);
        const onKey = (e: React.KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save(r, false);
          }
        };
        const edit = (k: "p" | "a", v: string) => patch(r.roundId, { [k]: leadingDigits(v), warnings: null, reason: "" });
        return (
          <div key={r.roundId} className={`mrow${isSaved ? " saved" : ""}`}>
            <div className="mhub">
              <strong>{r.hub}</strong> <span className="muted small">{r.zone}</span>
              <div className="small muted num">Shift {r.label}</div>
              <span className={`chip ${isSaved ? "okc" : chip.cls}`}>{isSaved ? "✓ Entered" : chip.text}</span>
            </div>

            <div className="mfield">
              <label htmlFor={`mp-${r.roundId}`}>Planned</label>
              <input id={`mp-${r.roundId}`} type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={s.p} placeholder="0" disabled={s.busy}
                onChange={(e) => edit("p", e.target.value)} onKeyDown={onKey} />
              {r.hintPlan !== null && s.p === "" && (
                <button type="button" className="hintbtn" onClick={() => patch(r.roundId, { p: String(r.hintPlan) })}>Last: {r.hintPlan}</button>
              )}
            </div>

            <div className="mfield">
              <label htmlFor={`ma-${r.roundId}`}>Actual</label>
              <input id={`ma-${r.roundId}`} type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={s.a} placeholder="0" disabled={s.busy}
                onChange={(e) => edit("a", e.target.value)} onKeyDown={onKey} />
            </div>

            <div className="mneed" aria-live="polite">
              <div className="small muted">Ad-hoc needed</div>
              {need === null ? <strong>–</strong> : <strong className={`adhoc ${need > 0 ? "pos" : need < 0 ? "neg" : ""}`}>{need > 0 ? `+${need}` : need}</strong>}{" "}
              {cls === "LOW" && <span className="chip low">▼ LOW</span>}
              {cls === "EXCESS" && <span className="chip excess">▲ EXCESS</span>}
              {cls === "OK" && <span className="chip okc">✓ OK</span>}
            </div>

            {(cls === "LOW" || cls === "EXCESS") && !isSaved && (
              <div className="mreason">
                <label htmlFor={`mr-${r.roundId}`}>Reason (optional)</label>
                <select id={`mr-${r.roundId}`} value={s.reason} disabled={s.busy} onChange={(e) => patch(r.roundId, { reason: e.target.value })}>
                  <option value="">Select a reason</option>
                  {reasons.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
            )}

            <div className="msave">
              <button className="btn" disabled={s.busy || p === null || a === null} onClick={() => save(r, false)}>
                {s.busy ? "Saving…" : s.saved ? "Update" : "Save"}
              </button>
              {isSaved && <div className="small" style={{ color: "var(--ok)", marginTop: 4 }}>✓ Saved</div>}
            </div>

            {(s.err || s.warnings) && (
              <div className="mmsg">
                {s.err && <div className="msg err" role="alert" style={{ margin: 0 }}>{s.err}</div>}
                {s.warnings && (
                  <div className="msg warn" role="alert" style={{ margin: 0 }}>
                    <strong>Please check:</strong> {s.warnings.join(" ")}
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="btn small" disabled={s.busy} onClick={() => save(r, true)}>Yes, save</button>
                      <button className="btn secondary small" onClick={() => patch(r.roundId, { warnings: null })}>Change numbers</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
