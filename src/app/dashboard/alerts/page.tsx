import { ClassChip } from "@/components/Chip";
import Shell from "@/components/Shell";
import { db } from "@/lib/db";
import { loadMaster } from "@/lib/master";
import { loadConfig } from "@/lib/config";
import { loadRoundsByIds } from "@/lib/rounds";
import { fmtDateTime, shiftLabel } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const cfg = await loadConfig();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await db()
    .from("alerts")
    .select("id,round_id,class,adhoc_needed,ack_required,acked_by,acked_at,ack_eta,repeat_count,created_at,resolved_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(300);
  const alerts = (data ?? []) as {
    id: string; round_id: string; class: "LOW" | "EXCESS"; adhoc_needed: number; ack_required: boolean; acked_by: string | null;
    acked_at: string | null; ack_eta: string | null; repeat_count: number; created_at: string; resolved_at: string | null;
  }[];
  const [master, rounds] = await Promise.all([loadMaster(), loadRoundsByIds([...new Set(alerts.map((a) => a.round_id))])]);
  const roundMap = new Map(rounds.map((r) => [r.id, r]));
  const open = alerts.filter((a) => !a.resolved_at);

  return (
    <Shell active="/dashboard/alerts">
      <h1>Alerts</h1>
      <p className="muted">Last 7 days. {open.length} open. LOW alerts (ad-hoc manpower needed) email HR and need the Zone HR to acknowledge. EXCESS is listed here for visibility only; nobody is emailed for it.</p>
      <section className="card">
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr><th>Raised</th><th>Hub</th><th>Zone</th><th>Shift</th><th>Level</th><th className="r">Ad-hoc needed</th><th>Acknowledgement</th><th>Status</th></tr>
            </thead>
            <tbody>
              {alerts.length === 0 && <tr><td colSpan={8} className="muted">No alerts in the last 7 days.</td></tr>}
              {alerts.map((a) => {
                const r = roundMap.get(a.round_id);
                const s = r ? master.shifts.get(r.hub_shift_id) : undefined;
                return (
                  <tr key={a.id}>
                    <td className="small num">{fmtDateTime(a.created_at, cfg.tzOff)}</td>
                    <td><strong>{s?.hub.name ?? "?"}</strong></td>
                    <td>{s?.hub.zone.name}</td>
                    <td className="num">{s ? shiftLabel(s.start, s.end) : ""}</td>
                    <td><ClassChip cls={a.class} /></td>
                    <td className="r num"><strong>{a.adhoc_needed > 0 ? `+${a.adhoc_needed}` : a.adhoc_needed}</strong></td>
                    <td className="small">
                      {a.class === "EXCESS" ? <span className="muted">shown only, no email sent</span>
                        : !a.ack_required ? <span className="muted">not required</span>
                        : a.acked_at ? <span className="chip okc">✓ {a.acked_by}</span>
                        : a.resolved_at ? <span className="muted">resolved</span>
                        : <span className="chip low">! Not acknowledged{a.repeat_count ? ` (chased ${a.repeat_count}×)` : ""}</span>}
                      {a.ack_eta ? <div className="muted">{a.ack_eta}</div> : null}
                    </td>
                    <td>{a.resolved_at ? <span className="chip neutral">Resolved</span> : <span className="chip warnc">● Open</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
