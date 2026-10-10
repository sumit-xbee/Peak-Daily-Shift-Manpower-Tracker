/** Shown instantly while a page's data loads, so a click always gives immediate feedback. */
export default function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <div className="skel" style={{ width: 220, height: 26, marginBottom: 10 }} />
      <div className="skel" style={{ width: "60%", height: 14, marginBottom: 20 }} />
      <div className="tiles">
        {[0, 1, 2, 3].map((i) => (
          <div className="tile" key={i}>
            <div className="skel" style={{ width: 90, height: 12, marginBottom: 10 }} />
            <div className="skel" style={{ width: 60, height: 26 }} />
          </div>
        ))}
      </div>
      <div className="card">
        <div className="skel" style={{ width: 160, height: 18, marginBottom: 14 }} />
        {[0, 1, 2, 3, 4].map((i) => (
          <div className="skel" key={i} style={{ width: `${95 - i * 9}%`, height: 14, marginBottom: 12 }} />
        ))}
      </div>
      <p className="muted small">Loading…</p>
    </div>
  );
}
