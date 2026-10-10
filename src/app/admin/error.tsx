"use client";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card stack" role="alert">
      <h2>This page could not load</h2>
      <p className="muted">The system may be busy for a moment. Please try again.</p>
      <div><button className="btn" onClick={() => reset()}>Try again</button></div>
    </div>
  );
}
