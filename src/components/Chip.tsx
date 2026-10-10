import type { ManpowerClass } from "@/lib/classify";
import type { RoundStatus } from "@/lib/schedule";

/** Colour is never alone: every chip carries an icon and a word. */
export function ClassChip({ cls }: { cls: ManpowerClass | null }) {
  if (cls === "LOW") return <span className="chip low">▼ LOW</span>;
  if (cls === "EXCESS") return <span className="chip excess">▲ EXCESS</span>;
  if (cls === "OK") return <span className="chip okc">✓ OK</span>;
  return <span className="chip neutral">–</span>;
}

const STATUS: Record<RoundStatus, { cls: string; icon: string; text: string }> = {
  NOT_DUE: { cls: "neutral", icon: "◷", text: "Not due" },
  OPEN: { cls: "warnc", icon: "●", text: "Pending" },
  OVERDUE: { cls: "low", icon: "!", text: "Overdue" },
  MISSED: { cls: "low", icon: "✕", text: "Missed" },
  SUBMITTED: { cls: "okc", icon: "✓", text: "Entered" },
  LATE: { cls: "warnc", icon: "✓", text: "Entered late" },
};

export function StatusChip({ status }: { status: RoundStatus }) {
  const s = STATUS[status];
  return <span className={`chip ${s.cls}`}>{s.icon} {s.text}</span>;
}

export function AdhocValue({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">–</span>;
  const cls = value > 0 ? "pos" : value < 0 ? "neg" : "";
  return <span className={`adhoc ${cls}`}>{value > 0 ? `+${value}` : value}</span>;
}
