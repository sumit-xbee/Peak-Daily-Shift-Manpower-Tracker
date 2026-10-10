import Shell from "@/components/Shell";
import { loadConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { mailerConfigured } from "@/lib/mailer";
import { sentTodayCount } from "@/lib/outbox";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function OutboxPage() {
  const cfg = await loadConfig();
  const { data } = await db().from("outbox").select("id,kind,to_email,subject,status,attempts,last_error,created_at,sent_at").order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as { id: string; kind: string; to_email: string; subject: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null }[];
  const count = async (s: string) => (await db().from("outbox").select("id", { count: "exact", head: true }).eq("status", s)).count ?? 0;
  const [pending, failed, sentToday, hb] = await Promise.all([count("pending"), count("failed"), sentTodayCount(cfg, new Date()), db().from("heartbeat").select("last_tick").eq("id", 1).single()]);
  const age = hb.data ? Math.round((Date.now() - new Date(hb.data.last_tick).getTime()) / 1000) : null;

  return (
    <Shell active="/admin/outbox" adminOnly>
      <h1>Emails and system health</h1>
      <div className="tiles">
        <div className="tile"><div className="l">Scheduler last ran</div><div className="v">{age === null ? "never" : age < 90 ? "just now" : `${Math.round(age / 60)} min ago`}</div></div>
        <div className="tile"><div className="l">Sent today</div><div className="v">{sentToday}/{cfg.dailySendCap}</div></div>
        <div className="tile"><div className="l">Waiting to send</div><div className="v">{pending}</div></div>
        <div className="tile"><div className="l">Failed</div><div className="v">{failed}</div></div>
      </div>
      {!mailerConfigured() && <div className="msg err">Gmail is not configured (GMAIL_USER / GMAIL_APP_PASSWORD). No email can be sent.</div>}
      {cfg.dryRun && <div className="msg warn">Dry run is ON: every email goes to {cfg.dryRunTo || "(nobody)"} instead of the real recipient. Turn it off in Settings when you go live.</div>}
      {!cfg.systemEnabled && <div className="msg warn">The system is switched OFF. No rounds are opened and no emails are sent.</div>}
      <section className="card">
        <h2>Latest 100 emails</h2>
        <div className="tablewrap">
          <table className="t">
            <thead><tr><th>Queued</th><th>Type</th><th>To</th><th>Subject</th><th>Status</th><th>Tries</th><th>Error</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="small num">{fmtDateTime(r.created_at, cfg.tzOff)}</td>
                  <td className="small">{r.kind}</td>
                  <td className="small">{r.to_email}</td>
                  <td className="small">{r.subject}</td>
                  <td>{r.status === "sent" ? <span className="chip okc">✓ sent</span> : r.status === "failed" ? <span className="chip low">✕ failed</span> : <span className="chip warnc">● {r.status}</span>}</td>
                  <td className="num">{r.attempts}</td>
                  <td className="small" style={{ color: "var(--short)" }}>{r.last_error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
