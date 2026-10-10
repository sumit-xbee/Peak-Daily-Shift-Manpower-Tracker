import Link from "next/link";

/** Date and zone filter. A plain GET form, so the URL is shareable. */
export default function DashControls({
  path, date, today, zone, zones, prev, next,
}: { path: string; date: string; today: string; zone?: string; zones?: string[]; prev: string; next: string }) {
  const qs = (d: string) => `${path}?date=${d}${zone ? `&zone=${encodeURIComponent(zone)}` : ""}`;
  return (
    <form method="get" action={path} className="row" style={{ marginBottom: 16 }}>
      <div className="row" style={{ gap: 6 }}>
        <Link className="btn secondary small" href={qs(prev)} aria-label="Previous day">←</Link>
        <input type="date" name="date" defaultValue={date} aria-label="Date" style={{ width: 170 }} />
        <Link className="btn secondary small" href={qs(next)} aria-label="Next day">→</Link>
        {date !== today && <Link className="btn secondary small" href={qs(today)}>Today</Link>}
      </div>
      {zones && (
        <select name="zone" defaultValue={zone ?? ""} aria-label="Zone" style={{ width: 180 }}>
          <option value="">All zones</option>
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      )}
      <button className="btn small">Show</button>
    </form>
  );
}
