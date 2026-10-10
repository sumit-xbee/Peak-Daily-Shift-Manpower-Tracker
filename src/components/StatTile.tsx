import { deltaView, type GoodWhen } from "@/lib/delta";

export type Tone = "neutral" | "good" | "bad" | "warn" | "info";

const TONE_COLOR: Record<Tone, string> = {
  neutral: "var(--axis)",
  good: "var(--good)",
  bad: "var(--bad)",
  warn: "var(--amber)",
  info: "var(--excess)",
};

/** A headline number with its day-on-day change in brackets (green = better, red = worse). */
export default function StatTile({
  label, value, prev, good = "neutral", tone = "neutral", vs, hint, of,
}: {
  /** shown small after the value, e.g. the 9 in "2 / 9" */
  of?: number;
  label: string;
  value: number | string;
  /** the same metric for the comparison period; omit or null if there is none */
  prev?: number | null;
  good?: GoodWhen;
  tone?: Tone;
  vs?: string;
  hint?: string;
}) {
  const d = typeof value === "number" ? deltaView(value, prev, good, vs) : null;
  return (
    <div className="tile" style={{ ["--tone" as string]: TONE_COLOR[tone] }} title={hint}>
      <div className="l">{label}</div>
      <div className="v">
        {value}
        {of !== undefined && <span className="of"> / {of}</span>}
        {d && (
          <span className={`d ${d.tone}`} title={d.label} aria-label={d.label}>
            {d.text}
          </span>
        )}
      </div>
    </div>
  );
}
