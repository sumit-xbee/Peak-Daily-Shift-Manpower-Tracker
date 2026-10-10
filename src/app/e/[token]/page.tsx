import EntryForm from "@/components/EntryForm";
import { resolveLink } from "@/lib/auth";
import { loadDay, pocNames, sortViews } from "@/lib/dashdata";
import { REASONS } from "@/lib/entry";
import { toEntryRows } from "@/lib/entryprep";
import { loadRoundsByIds } from "@/lib/rounds";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enter manpower" };

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

export default async function EntryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lookup = await resolveLink(token, ["poc", "delegate"]);
  if (!lookup.ok) {
    return lookup.reason === "expired" ? (
      <Notice title="This link has expired" body="The time to enter for this shift is over. You can still add missing numbers by logging in to the dashboard (Enter / missing tab) with your XB email." />
    ) : (
      <Notice title="This link is not valid" body="Please open the link from the latest email, or ask your hub in-charge to forward it again." />
    );
  }
  const link = lookup.link;

  // all rounds on this link share a date in practice; use the first one
  const first = await loadRoundsByIds(link.roundIds.slice(0, 1));
  const date = first[0]?.round_date;
  const day = await loadDay(date);
  if (!day.cfg.systemEnabled) return <Notice title="Tracking is paused" body="Manpower tracking is switched off at the moment. Nothing needs to be entered." />;

  const mine = sortViews(day.views.filter((v) => link.roundIds.includes(v.round.id)));
  if (!mine.length) return <Notice title="Nothing to enter" body="These shifts could not be found." />;

  const rows = await toEntryRows(mine);
  const person = link.personId ? day.master.people.get(link.personId) : undefined;
  const off = day.cfg.tzOff;

  // accountability board: who has entered, who has not
  const myZones = new Set(mine.map((v) => v.shift.hub.zone.id));
  const scope = day.cfg.statusBoardScope;
  const board = sortViews(
    day.views.filter((v) => v.times.opensAt.getTime() <= day.now.getTime()).filter((v) => (scope === "all" ? true : scope === "own" ? link.roundIds.includes(v.round.id) : myZones.has(v.shift.hub.zone.id))),
  );
  const notEntered = board.filter((v) => !v.entry);
  const entered = board.filter((v) => v.entry);

  return (
    <div className="narrow">
      <h1>Enter manpower</h1>
      <p className="muted">
        {link.kind === "delegate" ? "Shared with you by the hub POC. " : person ? `Hi ${person.name}. ` : ""}
        Enter both numbers for {mine.length === 1 ? "this shift" : "each shift"}. It takes about 30 seconds.
      </p>

      <EntryForm rows={rows} token={token} canDelegate={link.kind === "poc"} allowedDomains={day.cfg.allowedDomains} reasons={REASONS} />

      <section className="card" aria-labelledby="board" style={{ marginTop: 24 }}>
        <h2 id="board">Who has entered{scope === "zone" ? " (your zone)" : scope === "all" ? " (all hubs)" : ""}</h2>
        <div className="board-cols">
          <div>
            <h3><span className="chip warnc">● Not entered ({notEntered.length})</span></h3>
            {notEntered.length === 0 && <p className="muted small">Everyone has entered.</p>}
            {notEntered.map((v) => (
              <div className="board-item" key={v.round.id}>
                <strong>{v.shift.hub.name}</strong> <span className="muted">{v.label}</span>
                <div className="small muted">{pocNames(v)}</div>
              </div>
            ))}
          </div>
          <div>
            <h3><span className="chip okc">✓ Entered ({entered.length})</span></h3>
            {entered.length === 0 && <p className="muted small">No entries yet.</p>}
            {entered.map((v) => (
              <div className="board-item" key={v.round.id}>
                <strong>{v.shift.hub.name}</strong> <span className="muted">{v.label}</span>
                <div className="small muted">{v.entry!.latest.entered_by_email} · {fmtDateTime(v.entry!.latest.created_at, off)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
