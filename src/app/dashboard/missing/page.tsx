import { StatusChip } from "@/components/Chip";
import DashControls from "@/components/DashControls";
import MissingRows from "@/components/MissingRows";
import Shell from "@/components/Shell";
import { requireSession } from "@/lib/auth";
import { loadDay, nextDay, prevDay, sortViews } from "@/lib/dashdata";
import { REASONS } from "@/lib/entry";
import { toEntryRows } from "@/lib/entryprep";

export const dynamic = "force-dynamic";

const URGENCY: Record<string, number> = { MISSED: 0, OVERDUE: 1, OPEN: 2 };

/** The fallback for a missed email: anyone logged in can enter missing numbers at any time of the day. */
export default async function MissingPage({ searchParams }: { searchParams: Promise<{ date?: string; zone?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const day = await loadDay(sp.date);
  const zones = [...day.master.zones.values()].map((z) => z.name).sort();
  const zone = sp.zone && zones.includes(sp.zone) ? sp.zone : "";

  // most urgent first (missed, then overdue, then pending), then by zone / hub / shift
  const order = new Map(sortViews(day.views).map((v, i) => [v.round.id, i]));
  const missing = day.views
    .filter((v) => !v.entry && v.times.opensAt.getTime() <= day.now.getTime())
    .filter((v) => !zone || v.shift.hub.zone.name === zone)
    .sort((a, b) => (URGENCY[a.status] ?? 3) - (URGENCY[b.status] ?? 3) || (order.get(a.round.id) ?? 0) - (order.get(b.round.id) ?? 0));
  const rows = await toEntryRows(missing);

  return (
    <Shell active="/dashboard/missing">
      <h1>Enter missing numbers</h1>
      <p className="muted">
        Shifts that have opened but have no entry yet. Type Planned and Actual Manpower – Hub Processing and press <strong>Save</strong> on that line (or press Enter).
        Late entries are accepted and marked &quot;late&quot;. Saved under {session.email}.
      </p>
      <DashControls path="/dashboard/missing" date={day.date} today={day.today} zone={zone} zones={zones} prev={prevDay(day.date)} next={nextDay(day.date)} />
      {rows.length === 0 ? (
        <div className="msg ok">✓ Nothing is missing for {day.date}{zone ? ` in ${zone}` : ""}.</div>
      ) : (
        <>
          <p className="small muted">
            {missing.length} shift(s) missing, {missing.filter((v) => v.status === "MISSED").length} past cut-off.{" "}
            <StatusChip status="MISSED" /> and <StatusChip status="OVERDUE" /> are listed first.
          </p>
          {/* the key makes a different day or zone start a fresh list instead of reusing the old rows' state */}
          <MissingRows key={`${day.date}|${zone}`} rows={rows} reasons={REASONS} />
        </>
      )}
    </Shell>
  );
}
