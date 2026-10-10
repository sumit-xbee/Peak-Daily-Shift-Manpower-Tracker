import { ClassChip } from "@/components/Chip";
import DashControls from "@/components/DashControls";
import DivergingBars, { type BarRow } from "@/components/DivergingBars";
import Shell from "@/components/Shell";
import { loadDay, nextDay, prevDay, totals } from "@/lib/dashdata";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ZoneView({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const day = await loadDay(sp.date);
  const zones = [...day.master.zones.values()].sort((a, b) => a.name.localeCompare(b.name));

  const rows = zones.map((z) => {
    const vs = day.views.filter((v) => v.shift.hub.zone.id === z.id);
    return { zone: z, t: totals(vs) };
  });
  const all = totals(day.views);

  const chart: BarRow[] = rows.map((r) => ({
    label: r.zone.name,
    short: r.t.shortOnly,
    excess: r.t.excessOnly,
    detail: `Net ad-hoc needed ${r.t.net}. ${r.t.entered}/${r.t.due} shifts entered.`,
  }));

  return (
    <Shell active="/dashboard/zones">
      <h1>Zone view</h1>
      <p className="muted">
        Shortfall-only and excess-only are shown separately, so one hub&apos;s excess never hides another hub&apos;s shortfall. Net = Planned − Actual summed.
      </p>
      <DashControls path="/dashboard/zones" date={day.date} today={day.today} prev={prevDay(day.date)} next={nextDay(day.date)} />

      <div className="tiles">
        <div className="tile"><div className="l">Entered</div><div className="v">{all.entered}/{all.due}</div></div>
        <div className="tile"><div className="l">People needed (shortfalls)</div><div className="v">{all.shortOnly}</div></div>
        <div className="tile"><div className="l">People in excess</div><div className="v">{all.excessOnly}</div></div>
        <div className="tile"><div className="l">Net ad-hoc needed</div><div className="v">{all.net}</div></div>
      </div>

      <section className="card" aria-labelledby="zc">
        <h2 id="zc">Shortfall vs excess by zone</h2>
        <DivergingBars rows={chart} shortLabel="Short: ad-hoc manpower needed (sum of shortfalls)" excessLabel="Excess: above plan (sum of excesses)" />
      </section>

      <section className="card" aria-labelledby="zt">
        <h2 id="zt">Zones</h2>
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th>Zone</th><th>Zone RM</th><th>Zone HR</th><th className="r">Entered</th><th className="r">Compliance</th>
                <th className="r">Planned</th><th className="r">Actual</th><th className="r">Net ad-hoc needed</th>
                <th className="r">Shortfall-only</th><th className="r">Excess-only</th><th className="r">LOW</th><th className="r">EXCESS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ zone, t }) => (
                <tr key={zone.id}>
                  <td><Link href={`/dashboard?date=${day.date}&zone=${encodeURIComponent(zone.name)}`}><strong>{zone.name}</strong></Link></td>
                  <td className="small">{zone.rm.name}</td>
                  <td className="small">{zone.hr.name}</td>
                  <td className="r num">{t.entered}/{t.due}</td>
                  <td className="r num">{t.due ? `${Math.round((t.entered / t.due) * 100)}%` : "–"}</td>
                  <td className="r num">{t.planned}</td>
                  <td className="r num">{t.actual}</td>
                  <td className="r num"><strong>{t.net > 0 ? `+${t.net}` : t.net}</strong></td>
                  <td className="r num adhoc pos">{t.shortOnly}</td>
                  <td className="r num adhoc neg">{t.excessOnly}</td>
                  <td className="r">{t.low ? <ClassChip cls="LOW" /> : "–"} {t.low ? <span className="num">{t.low}</span> : null}</td>
                  <td className="r">{t.excess ? <ClassChip cls="EXCESS" /> : "–"} {t.excess ? <span className="num">{t.excess}</span> : null}</td>
                </tr>
              ))}
              <tr>
                <td><strong>All zones</strong></td><td /><td />
                <td className="r num">{all.entered}/{all.due}</td>
                <td className="r num">{all.due ? `${Math.round((all.entered / all.due) * 100)}%` : "–"}</td>
                <td className="r num">{all.planned}</td><td className="r num">{all.actual}</td>
                <td className="r num"><strong>{all.net > 0 ? `+${all.net}` : all.net}</strong></td>
                <td className="r num adhoc pos">{all.shortOnly}</td><td className="r num adhoc neg">{all.excessOnly}</td>
                <td className="r num">{all.low}</td><td className="r num">{all.excess}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
