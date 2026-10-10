"use client";

import { useState } from "react";

export interface BarRow {
  label: string;
  sub?: string;
  /** manpower still needed (shortfall), drawn to the right */
  short: number;
  /** manpower above plan (excess), drawn to the left */
  excess: number;
  detail?: string;
}

interface Props {
  rows: BarRow[];
  /** threshold lines drawn at +-limit */
  limit?: number;
  shortLabel?: string;
  excessLabel?: string;
}

const W = 760;
const LEFT = 190;
const RIGHT = 56;
const ROW = 30;
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

const niceMax = (v: number) => {
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 1000) * 1000;
};

export default function DivergingBars({ rows, limit, shortLabel = "Short: ad-hoc manpower needed", excessLabel = "Excess: above plan" }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; row: BarRow } | null>(null);
  if (!rows.length) return <p className="muted">No entries to chart yet.</p>;

  const biggest = Math.max(1, limit ?? 0, ...rows.map((r) => Math.max(r.short, r.excess)));
  const max = niceMax(biggest);
  const plotW = W - LEFT - RIGHT;
  const cx = LEFT + plotW / 2;
  const half = plotW / 2;
  const sx = (v: number) => (v / max) * half;
  const H = TOP + rows.length * ROW + 8;

  return (
    <div className="chart">
      <div className="legend" aria-hidden="false">
        <span><i style={{ background: "var(--short)" }} />▼ {shortLabel}</span>
        <span><i style={{ background: "var(--excess)" }} />▲ {excessLabel}</span>
        {limit ? <span><i style={{ background: "var(--axis)", height: 2, verticalAlign: 3 }} />Alert limit ±{limit}</span> : null}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ad-hoc manpower needed per row. Bars to the right are shortfalls, bars to the left are excess.">
        {/* axis ticks */}
        {[-max, -max / 2, 0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={cx + sx(t)} x2={cx + sx(t)} y1={TOP - 6} y2={H - 6} stroke="var(--line)" strokeWidth={1} />
            <text x={cx + sx(t)} y={TOP - 12} textAnchor="middle" fontSize={11} fill="var(--muted)">{t > 0 ? `+${t}` : t}</text>
          </g>
        ))}
        {limit ? [-limit, limit].map((t) => (
          <line key={`l${t}`} x1={cx + sx(t)} x2={cx + sx(t)} y1={TOP - 6} y2={H - 6} stroke="var(--axis)" strokeWidth={1.5} />
        )) : null}
        <line x1={cx} x2={cx} y1={TOP - 6} y2={H - 6} stroke="var(--axis)" strokeWidth={1.5} />

        {rows.map((r, i) => {
          const y = TOP + i * ROW + (ROW - BAR) / 2;
          return (
            <g key={r.label + i}>
              <text x={LEFT - 10} y={y + BAR / 2 + 4} textAnchor="end" fontSize={12.5} fill="var(--ink)">
                {r.label.length > 24 ? r.label.slice(0, 23) + "…" : r.label}
              </text>
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
              {/* hit target is bigger than the mark */}
              <rect
                x={0} y={TOP + i * ROW} width={W} height={ROW} fill="transparent"
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, row: r })}
                onMouseLeave={() => setTip(null)}
              >
                <title>{`${r.label}${r.sub ? " " + r.sub : ""}: ${r.short > 0 ? `short by ${r.short}` : r.excess > 0 ? `${r.excess} above plan` : "on plan"}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 14, typeof window !== "undefined" ? window.innerWidth - 300 : tip.x), top: tip.y + 14 }}>
          <strong>{tip.row.label}</strong>
          {tip.row.sub ? <div>{tip.row.sub}</div> : null}
          <div>{tip.row.short > 0 ? `Short by ${tip.row.short}` : tip.row.excess > 0 ? `${tip.row.excess} above plan` : "On plan"}</div>
          {tip.row.detail ? <div style={{ opacity: 0.85 }}>{tip.row.detail}</div> : null}
        </div>
      )}
    </div>
  );
}
