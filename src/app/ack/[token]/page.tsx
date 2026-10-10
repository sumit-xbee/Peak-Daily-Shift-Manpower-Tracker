import AckForm from "@/components/AckForm";
import Logo from "@/components/Logo";
import { resolveLink } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { loadMaster } from "@/lib/master";
import { loadRoundsByIds } from "@/lib/rounds";
import { shiftLabel } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acknowledge low manpower" };

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="narrow">
      <div className="card stack">
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
    </div>
  );
}

export default async function AckPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const l = await resolveLink(token, ["ack"]);
  if (!l.ok || !l.link.alertId) {
    return <Notice title={l.ok ? "This link is not valid" : l.reason === "expired" ? "This link has expired" : "This link is not valid"} body="Please use the latest email, or open the dashboard." />;
  }
  const alert = (await db().from("alerts").select("id,round_id,adhoc_needed,acked_by,acked_at,ack_eta,resolved_at").eq("id", l.link.alertId).maybeSingle()).data;
  if (!alert) return <Notice title="Alert not found" body="This alert no longer exists." />;

  const [cfg, master, rounds] = await Promise.all([loadConfig(), loadMaster(), loadRoundsByIds([alert.round_id])]);
  const shift = rounds[0] ? master.shifts.get(rounds[0].hub_shift_id) : undefined;
  const what = shift ? `${shift.hub.name} (${shift.hub.zone.name}), shift ${shiftLabel(shift.start, shift.end)}` : "this shift";

  if (alert.resolved_at) return <Notice title="Already resolved" body={`The low-manpower alert for ${what} was resolved: the numbers were corrected. Nothing more to do.`} />;
  if (alert.acked_at) return <Notice title="Already acknowledged" body={`${what} was acknowledged by ${alert.acked_by}. Action / ETA: ${alert.ack_eta ?? "-"}.`} />;

  return (
    <div className="narrow">
      <div style={{ marginBottom: 14 }}>
        <Logo height={32} />
      </div>
      <div className="card stack">
        <h1>Low manpower: please acknowledge</h1>
        <p>
          <strong>{what}</strong> is short by <strong>{alert.adhoc_needed}</strong>. Tell us what is being done and by when.
        </p>
        <AckForm token={token} allowedDomains={cfg.allowedDomains} />
      </div>
    </div>
  );
}
