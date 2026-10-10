"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "./Logo";
import LogoutButton from "./LogoutButton";

const TABS = [
  { href: "/dashboard", label: "Hub view" },
  { href: "/dashboard/zones", label: "Zone view" },
  { href: "/dashboard/missing", label: "Enter / missing" },
  { href: "/dashboard/alerts", label: "Alerts" },
];
// Only the System Admin ever sees (or can open) these three.
const ADMIN_TABS = [
  { href: "/admin/poc", label: "POC directory" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/outbox", label: "Emails" },
];

export default function NavBar({ email, isAdmin }: { email: string; isAdmin: boolean }) {
  const path = usePathname();
  // highlight the tab the moment it is clicked, not when the page finally arrives
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [path]);
  const current = pending ?? path;
  const tabs = isAdmin ? [...TABS, ...ADMIN_TABS] : TABS;

  return (
    <nav className="nav" aria-label="Main">
      <div className="wrap navrow">
        <Link href="/dashboard" className="brandlink" aria-label="Xpressbees Peak Shift Tracker, home">
          <Logo height={30} />
          <span className="brand">Peak Shift Tracker</span>
        </Link>
        <div className="tabs">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} className="tab" aria-current={current === t.href ? "page" : undefined} onClick={() => setPending(t.href)}>
              {t.label}
            </Link>
          ))}
        </div>
        <span className="who">
          <span className="whoemail" title={email}>{email}</span>
          <LogoutButton />
        </span>
      </div>
    </nav>
  );
}
