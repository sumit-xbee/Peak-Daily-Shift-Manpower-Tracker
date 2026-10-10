import { AdhocValue, ClassChip, StatusChip } from "@/components/Chip";
import DashControls from "@/components/DashControls";
import DivergingBars, { type BarRow } from "@/components/DivergingBars";
import Shell from "@/components/Shell";
import StatTile from "@/components/StatTile";
import { loadCompare, loadDay, nextDay, pocNames, prevDay, sortViews, totals } from "@/lib/dashdata";
import { gapPercent } from "@/lib/classify";
import { fmtPct } from "@/lib/report";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function HubView({ searchParams }: { searchParams: Promise<{ date?: string; zone?: string }> }) {
  const sp = await searchParams;
  const [day, cmp] = await Promise.all([loadDay(sp.date), loadCompare(sp.date)]); // both at once
  const zones = [...day.master.zones.values()].map((z) => z.name).sort();
  const zone = sp.zone && zones.includes(sp.zone) ? sp.zone : "";
  const views = sortViews(day.views.filter((v) => !zone || v.shift.hub.zone.name === zone));
  const t = totals(views);
  const p = cmp ? totals(cmp.views.filter((v) => !zone || v.shift.hub.zone.name === zone)) : null; // the same zone filter, for the day before
  const off = day.cfg.tzOff;

  // chart: the largest gaps against plan first (by %), entered rows only
  const entered = views.filter((v) => v.entry);
  const gapOf = (v: (typeof entered)[number]) => Math.abs(gapPercent(v.entry!.latest.planned, v.entry!.latest.actual) ?? 0);
  const chartRows: BarRow[] = [...entered]
    .sort((a, b) => gapOf(b) - gapOf(a) || Math.abs(b.entry!.latest.adhoc_needed) - Math.abs(a.entry!.latest.adhoc_needed))
    .slice(0, 25)
    .map((v) => {
      const n = v.entry!.latest.adhoc_needed;
      return {
        label: `${v.shift.hub.name} ${v.label}`,
        short: n > 0 ? n : 0,
        excess: n < 0 ? -n : 0,
        detail: `Planned ${v.entry!.latest.planned}, Actual ${v.entry!.latest.actual}, gap ${fmtPct(gapPercent(v.entry!.latest.planned, v.entry!.latest.actual))}`,
      };
    });

  return (
    <Shell active="/dashboard">
      <h1>Hub view</h1>
      <p className="muted">
        Ad-hoc manpower needed = Planned − Actual (Hub Processing). Positive means more people are needed.{" "}
        {day.cfg.thresholds.mode === "percent"
          ? `LOW = actual is ${day.cfg.thresholds.lowPct}% or more below planned (HR is alerted). EXCESS = ${day.cfg.thresholds.excessPct}% or more above planned (shown here only, no email).`
          : `LOW = short by ${day.cfg.thresholds.low} or more (HR is alerted). EXCESS = ${day.cfg.thresholds.excess} or more above plan (shown here only, no email).`}
      </p>
      <DashControls path="/dashboard" date={day.date} today={day.today} zone={zone} zones={zones} prev={prevDay(day.date)} next={nextDay(day.date)} />

      <div className="tiles">
        <StatTile label="Shifts due" value={t.due} prev={p?.due} good="neutral" vs={cmp?.label} />
        <StatTile label="Entered" value={t.entered} of={t.due} prev={p?.entered} good="up" tone="good" vs={cmp?.label} hint={`${t.entered} of ${t.due} shifts have an entry`} />
        <StatTile label="Pending" value={t.pending} prev={p?.pending} good="down" tone="warn" vs={cmp?.label} />
        <StatTile label="Missed" value={t.missed} prev={p?.missed} good="down" tone="bad" vs={cmp?.label} />
        <StatTile label="LOW shifts" value={t.low} prev={p?.low} good="down" tone="bad" vs={cmp?.label} />
        <StatTile label="EXCESS shifts" value={t.excess} prev={p?.excess} good="down" tone="info" vs={cmp?.label} />
        <StatTile label="People needed" value={t.shortOnly} prev={p?.shortOnly} good="down" tone="bad" vs={cmp?.label} hint="Sum of shortfalls: ad-hoc manpower needed" />
        <StatTile label="People in excess" value={t.excessOnly} prev={p?.excessOnly} good="down" tone="info" vs={cmp?.label} hint="Sum of excess above plan" />
      </div>
      <p className="small muted tilenote">
        {cmp ? <>Brackets show the change {cmp.label}. <span className="d good">Green</span> = better, <span className="d bad">red</span> = worse.</> : "No data for the previous day yet, so there are no day-on-day changes to show."}
      </p>

      <section className="card" aria-labelledby="chart-h">
        <h2 id="chart-h">Largest gaps vs plan {entered.length > 25 ? `(top 25 of ${entered.length})` : ""}</h2>
        <DivergingBars rows={chartRows} limit={day.cfg.thresholds.mode === "absolute" ? Math.max(day.cfg.thresholds.low, day.cfg.thresholds.excess) : undefined} />
      </section>

      <section className="card" aria-labelledby="tbl-h">
        <h2 id="tbl-h">All shifts ({views.length})</h2>
        {views.length === 0 ? (
          <p className="muted">No shifts have opened for this date yet.</p>
        ) : (
          <div className="tablewrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Hub</th><th>Zone</th><th>Shift</th><th>POCs</th>
                  <th className="r">Planned – Hub Processing</th><th className="r">Actual – Hub Processing</th>
                  <th className="r">AD-HOC MANPOWER NEEDED</th><th className="r">Gap vs plan</th><th>Level</th><th>Entry</th><th>Entered by</th><th>Alert</th>
                </tr>
              </thead>
              <tbody>
                {views.map((v) => {
                  const e = v.entry?.latest;
                  const al = day.alerts.get(v.round.id);
                  return (
                    <tr key={v.round.id}>
                      <td><strong>{v.shift.hub.name}</strong></td>
                      <td className="nowrap">{v.shift.hub.zone.name}</td>
                      <td className="num nowrap">{v.label}</td>
                      <td className="small pocs">{pocNames(v).split(" / ").map((n) => <div key={n}>{n}</div>)}</td>
                      <td className="r num">{e ? e.planned : "–"}</td>
                      <td className="r num">{e ? e.actual : "–"}</td>
                      <td className="r"><AdhocValue value={e ? e.adhoc_needed : null} /></td>
                      <td className="r num">{e ? fmtPct(gapPercent(e.planned, e.actual)) : "–"}</td>
                      <td><ClassChip cls={v.cls} /></td>
                      <td><StatusChip status={v.status} /></td>
                      <td className="small">
                        {e ? (
                          <>
                            {e.entered_by_email}<br />
                            <span className="muted">{fmtDateTime(e.created_at, off)}{v.entry!.count > 1 ? " · edited" : ""}{v.entry!.planChanged ? " · plan changed" : ""}{e.source === "delegate" ? " · delegate" : ""}{e.source === "dashboard" ? " · dashboard" : ""}</span>
                          </>
                        ) : <span className="muted">–</span>}
                      </td>
                      <td className="small">
                        {al?.class === "LOW" ? (al.ackedAt ? <span className="chip okc">✓ Acknowledged{al.ackEta ? `: ${al.ackEta}` : ""}</span> : al.ackRequired ? <span className="chip low">! Not acknowledged</span> : null) : null}
                        {al?.class === "EXCESS" ? <span className="muted">shown only, no email</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
