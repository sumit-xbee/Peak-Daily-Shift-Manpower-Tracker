"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A thin loading bar at the top of the screen. It starts the instant someone clicks a link
 * or submits a filter, creeps forward while the next page loads, and completes when it arrives.
 */
export default function NavProgress() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const start = () => {
      if (timer.current) clearTimeout(timer.current);
      setState("loading");
      timer.current = setTimeout(() => setState("idle"), 20000); // never get stuck
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement | null;
      if (f && (f.method || "get").toLowerCase() === "get" && !e.defaultPrevented) start();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  // the new page has arrived
  useEffect(() => {
    setState((s) => (s === "loading" ? "done" : s));
    if (timer.current) clearTimeout(timer.current);
    const t = setTimeout(() => setState("idle"), 400);
    return () => clearTimeout(t);
  }, [path, search]);

  if (state === "idle") return null;
  return (
    <div className="navprogress" role="progressbar" aria-label="Loading page" aria-busy={state === "loading"}>
      <div className={`navprogress-bar ${state}`} />
    </div>
  );
}
