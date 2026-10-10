"use client";

import { useState } from "react";

export interface BarRow {
  /** the hub (or zone) name: always shown in full on its own line */
  label: string;
  /** a second, smaller line, e.g. the shift time */
  sub?: string;
  /** manpower still needed (shortfall), drawn to the right */
  short: number;
  /** manpower above plan (excess), drawn to the left */
  excess: number;
  detail?: string;
}

interface Props {
  rows: BarRow[];
  /** alert lines (headcount mode only): drawn at +limitShort and -limitExcess */
  limitShort?: number;
  limitExcess?: number;
  shortLabel?: string;
  excessLabel?: string;
}

const W = 760;
const LEFT = 200;
const RIGHT = 56;
const ROW = 40;
const BAR = 18; // thin marks: no more than 24px
const TOP = 28;

/** Bar anchored at the centre line with a 4px rounded data end and a square baseline. */
function barPath(x0: number, x1: number, y: number, h: number): string {
  const dir = x1 >= x0 ? 1 : -1;
  const w = Math.abs(x1 - x0);
  if (w < 5) return `M${x0},${y} h${dir * w} v${h} h${-dir * w} Z`;
  const r = 4;
  const a = (dir * (w - r)).toFixed(2);
  return `M${x0},${y} h${a} a${r},${r} 0 0 ${dir === 1 ? 1 : 0} ${dir * r},${r} v${h - 2 * r} a${r},${r} 0 0 ${dir === 1 ? 1 : 0} ${-dir * r},${r} h${-(dir * (w - r)).toFixed(2)} Z`;
}

// every step is even, so the half-way tick is a whole number of people
const niceMax = (v: number) => {
  const steps = [10, 20, 40, 50, 100, 200, 400, 500, 1000, 2000, 4000, 5000, 10000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 1000) * 1000;
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default function DivergingBars({ rows, limitShort, limitExcess, shortLabel = "Short: ad-hoc manpower needed", excessLabel = "Excess: above plan" }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; row: BarRow } | null>(null);
  if (!rows.length) return <p className="muted">No entries to chart yet.</p>;

  const biggest = Math.max(1, limitShort ?? 0, limitExcess ?? 0, ...rows.map((r) => Math.max(r.short, r.excess)));
  const max = niceMax(biggest);
  const plotW = W - LEFT - RIGHT;
  const cx = LEFT + plotW / 2;
  const half = plotW / 2;
  const sx = (v: number) => (v / max) * half;
  const H = TOP + rows.length * ROW + 8;
  const hasLimits = limitShort !== undefined || limitExcess !== undefined;

  const verdict = (r: BarRow) => (r.short > 0 ? `short by ${r.short}` : r.excess > 0 ? `${r.excess} above plan` : "on plan");
  const summary = `Ad-hoc manpower needed, ${rows.length} rows. ` + rows.slice(0, 8).map((r) => `${r.label}${r.sub ? " " + r.sub : ""}: ${verdict(r)}`).join("; ") + (rows.length > 8 ? "; and more in the table below." : ".");

  return (
    <div className="chart">
      <div className="legend">
        <span><i style={{ background: "var(--short)" }} />▼ {shortLabel}</span>
        <span><i style={{ background: "var(--excess)" }} />▲ {excessLabel}</span>
        {hasLimits ? <span><i style={{ background: "var(--axis)", height: 2, verticalAlign: 3 }} />Alert limits</span> : null}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {/* axis ticks */}
        {[-max, -max / 2, 0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={cx + sx(t)} x2={cx + sx(t)} y1={TOP - 6} y2={H - 6} stroke="var(--line)" strokeWidth={1} />
            <text x={cx + sx(t)} y={TOP - 12} textAnchor="middle" fontSize={11} fill="var(--muted)">{t > 0 ? `+${t}` : t}</text>
          </g>
        ))}
        {/* each side has its own limit line, because the two limits can differ */}
        {limitShort !== undefined && <line x1={cx + sx(limitShort)} x2={cx + sx(limitShort)} y1={TOP - 6} y2={H - 6} stroke="var(--axis)" strokeWidth={1.5} />}
        {limitExcess !== undefined && <line x1={cx - sx(limitExcess)} x2={cx - sx(limitExcess)} y1={TOP - 6} y2={H - 6} stroke="var(--axis)" strokeWidth={1.5} />}
        <line x1={cx} x2={cx} y1={TOP - 6} y2={H - 6} stroke="var(--axis)" strokeWidth={1.5} />

        {rows.map((r, i) => {
          const y = TOP + i * ROW + (ROW - BAR) / 2;
          return (
            <g key={r.label + (r.sub ?? "") + i}>
              <text x={LEFT - 10} y={y + (r.sub ? 6 : BAR / 2 + 4)} textAnchor="end" fontSize={12.5} fontWeight={600} fill="var(--ink)">{clip(r.label, 28)}</text>
              {r.sub && <text x={LEFT - 10} y={y + 19} textAnchor="end" fontSize={11} fill="var(--muted)">{r.sub}</text>}
              {r.short > 0 && (
                <>
                  <path d={barPath(cx, cx + sx(r.short), y, BAR)} fill="var(--short)" />
                  <text x={cx + sx(r.short) + 6} y={y + BAR / 2 + 4} fontSize={12} fill="var(--ink)" fontWeight={600}>+{r.short}</text>
                </>
              )}
              {r.excess > 0 && (
                <>
                  <path d={barPath(cx, cx - sx(r.excess), y, BAR)} fill="var(--excess)" />
                  <text x={cx - sx(r.excess) - 6} y={y + BAR / 2 + 4} textAnchor="end" fontSize={12} fill="var(--ink)" fontWeight={600}>−{r.excess}</text>
                </>
              )}
              {/* hit target is bigger than the mark; focusable so the details are reachable without a mouse */}
              <rect
                x={0} y={TOP + i * ROW} width={W} height={ROW} fill="transparent" tabIndex={0}
                aria-label={`${r.label}${r.sub ? " " + r.sub : ""}: ${verdict(r)}${r.detail ? ". " + r.detail : ""}`}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, row: r })}
                onMouseLeave={() => setTip(null)}
                onFocus={(e) => { const b = e.currentTarget.getBoundingClientRect(); setTip({ x: b.left + 40, y: b.top, row: r }); }}
                onBlur={() => setTip(null)}
              >
                <title>{`${r.label}${r.sub ? " " + r.sub : ""}: ${verdict(r)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 14, typeof window !== "undefined" ? window.innerWidth - 300 : tip.x), top: tip.y + 14 }}>
          <strong>{tip.row.label}</strong>
          {tip.row.sub ? <div>{tip.row.sub}</div> : null}
          <div>{verdict(tip.row)}</div>
          {tip.row.detail ? <div style={{ opacity: 0.85 }}>{tip.row.detail}</div> : null}
        </div>
      )}
    </div>
  );
}
