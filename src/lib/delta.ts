// Day-on-day change shown in brackets on the stat cards.
export type GoodWhen = "up" | "down" | "neutral";

export interface DeltaView {
  /** e.g. "(▲ +4)" */
  text: string;
  tone: "good" | "bad" | "flat" | "neutral";
  /** read out by screen readers and shown as a tooltip */
  label: string;
}

const MINUS = "−";

/**
 * Change from the comparison period to now.
 * good = which direction is an improvement ("down" for pending, missed, shortfalls...).
 * Colour is never the only signal: the arrow and the sign carry it too.
 */
export function deltaView(cur: number, prev: number | null | undefined, good: GoodWhen, vs = "yesterday"): DeltaView | null {
  if (prev === null || prev === undefined) return null;
  const d = cur - prev;
  if (d === 0) return { text: "(= 0)", tone: "flat", label: `No change versus ${vs}` };
  const sign = d > 0 ? "+" : MINUS;
  const arrow = d > 0 ? "▲" : "▼";
  const abs = Math.abs(d);
  const tone: DeltaView["tone"] = good === "neutral" ? "neutral" : (d > 0) === (good === "up") ? "good" : "bad";
  const word = good === "neutral" ? "" : tone === "good" ? ", better" : ", worse";
  return { text: `(${arrow} ${sign}${abs})`, tone, label: `${d > 0 ? "Up" : "Down"} ${abs} versus ${vs}${word}` };
}
