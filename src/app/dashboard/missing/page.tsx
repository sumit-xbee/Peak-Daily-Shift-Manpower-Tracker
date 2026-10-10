import { StatusChip } from "@/components/Chip";
import DashControls from "@/components/DashControls";
import EntryForm from "@/components/EntryForm";
import Shell from "@/components/Shell";
import { loadDay, nextDay, prevDay, sortViews } from "@/lib/dashdata";
import { REASONS } from "@/lib/entry";
import { toEntryRows } from "@/lib/entryprep";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The fallback for a missed email: anyone logged in can enter missing numbers at any time of the day. */
export default async function MissingPage({ searchParams }: { searchParams: Promise<{ date?: string; zone?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const day = await loadDay(sp.date);
  const zones = [...day.master.zones.values()].map((z) => z.name).sort();
  const zone = sp.zone && zones.includes(sp.zone) ? sp.zone : "";

  const missing = sortViews(
    day.views.filter((v) => !v.entry && v.times.opensAt.getTime() <= day.now.getTime()).filter((v) => !zone || v.shift.hub.zone.name === zone),
  );
  const rows = await toEntryRows(missing);

  return (
    <Shell active="/dashboard/missing">
      <h1>Enter missing numbers</h1>
      <p className="muted">
        Shifts that have opened but have no entry yet. Enter Planned and Actual Manpower – Hub Processing. Late entries are accepted and marked &quot;late&quot;.
        Entries are saved under {session.email}.
      </p>
      <DashControls path="/dashboard/missing" date={day.date} today={day.today} zone={zone} zones={zones} prev={prevDay(day.date)} next={nextDay(day.date)} />
      {rows.length === 0 ? (
        <div className="msg ok">✓ Nothing is missing for {day.date}{zone ? ` in ${zone}` : ""}.</div>
      ) : (
        <>
          <p className="small muted">
            {missing.length} shift(s) missing. {missing.filter((v) => v.status === "MISSED").length} past cut-off.{" "}
            <StatusChip status="OVERDUE" /> / <StatusChip status="MISSED" /> rows are the most urgent.
          </p>
          <div style={{ maxWidth: 640 }}>
            <EntryForm rows={rows} sessionEmail={session.email} allowedDomains={day.cfg.allowedDomains} reasons={REASONS} />
          </div>
        </>
      )}
    </Shell>
  );
}
