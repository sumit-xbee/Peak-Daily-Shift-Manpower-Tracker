import { AdhocValue, ClassChip, StatusChip } from "@/components/Chip";
import DashControls from "@/components/DashControls";
import DivergingBars, { type BarRow } from "@/components/DivergingBars";
import Shell from "@/components/Shell";
import { loadDay, nextDay, pocNames, prevDay, sortViews, totals } from "@/lib/dashdata";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function HubView({ searchParams }: { searchParams: Promise<{ date?: string; zone?: string }> }) {
  const sp = await searchParams;
  const day = await loadDay(sp.date);
  const zones = [...day.master.zones.values()].map((z) => z.name).sort();
  const zone = sp.zone && zones.includes(sp.zone) ? sp.zone : "";
  const views = sortViews(day.views.filter((v) => !zone || v.shift.hub.zone.name === zone));
  const t = totals(views);
  const off = day.cfg.tzOff;

  // chart: the largest gaps first, entered rows only
  const entered = views.filter((v) => v.entry);
  const chartRows: BarRow[] = [...entered]
    .sort((a, b) => Math.abs(b.entry!.latest.adhoc_needed) - Math.abs(a.entry!.latest.adhoc_needed))
    .slice(0, 25)
    .map((v) => {
      const n = v.entry!.latest.adhoc_needed;
      return {
        label: `${v.shift.hub.name} ${v.label}`,
        short: n > 0 ? n : 0,
        excess: n < 0 ? -n : 0,
        detail: `Planned ${v.entry!.latest.planned}, Actual ${v.entry!.latest.actual}`,
      };
    });

  return (
    <Shell active="/dashboard">
      <h1>Hub view</h1>
      <p className="muted">Ad-hoc manpower needed = Planned − Actual (Hub Processing). Positive means more people are needed.</p>
      <DashControls path="/dashboard" date={day.date} today={day.today} zone={zone} zones={zones} prev={prevDay(day.date)} next={nextDay(day.date)} />

      <div className="tiles">
        <Tile l="Shifts due" v={`${t.due}`} />
        <Tile l="Entered" v={`${t.entered}/${t.due}`} />
        <Tile l="Pending" v={`${t.pending}`} />
        <Tile l="Missed" v={`${t.missed}`} />
        <Tile l="LOW shifts" v={`${t.low}`} />
        <Tile l="EXCESS shifts" v={`${t.excess}`} />
        <Tile l="People needed (shortfalls)" v={`${t.shortOnly}`} />
        <Tile l="People in excess" v={`${t.excessOnly}`} />
      </div>

      <section className="card" aria-labelledby="chart-h">
        <h2 id="chart-h">Largest gaps {entered.length > 25 ? `(top 25 of ${entered.length})` : ""}</h2>
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
                  <th className="r">AD-HOC MANPOWER NEEDED</th><th>Level</th><th>Entry</th><th>Entered by</th><th>Alert</th>
                </tr>
              </thead>
              <tbody>
                {views.map((v) => {
                  const e = v.entry?.latest;
                  const al = day.alerts.get(v.round.id);
                  return (
                    <tr key={v.round.id}>
                      <td><strong>{v.shift.hub.name}</strong></td>
                      <td>{v.shift.hub.zone.name}</td>
                      <td className="num">{v.label}</td>
                      <td className="small">{pocNames(v)}</td>
                      <td className="r num">{e ? e.planned : "–"}</td>
                      <td className="r num">{e ? e.actual : "–"}</td>
                      <td className="r"><AdhocValue value={e ? e.adhoc_needed : null} /></td>
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

function Tile({ l, v }: { l: string; v: string }) {
  return (
    <div className="tile">
      <div className="l">{l}</div>
      <div className="v">{v}</div>
    </div>
  );
}
