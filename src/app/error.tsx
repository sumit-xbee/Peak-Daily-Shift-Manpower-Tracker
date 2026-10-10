"use client";

/** Shown if a page fails to load (for example the database is slow). A clear message and a Retry button instead of a blank error. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="narrow">
      <div className="card stack" role="alert">
        <h1>This page could not load</h1>
        <p className="muted">The system may be busy for a moment. Nothing you entered has been lost. Please try again.</p>
        <div className="row">
          <button className="btn" onClick={() => reset()}>Try again</button>
          <a className="btn secondary" href="/dashboard">Go to the dashboard</a>
        </div>
      </div>
    </div>
  );
}
