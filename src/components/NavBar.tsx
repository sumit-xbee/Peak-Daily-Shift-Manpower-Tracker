import Link from "next/link";
import LogoutButton from "./LogoutButton";

const TABS = [
  { href: "/dashboard", label: "Hub view" },
  { href: "/dashboard/zones", label: "Zone view" },
  { href: "/dashboard/missing", label: "Enter / missing" },
  { href: "/dashboard/alerts", label: "Alerts" },
];
const ADMIN_TABS = [
  { href: "/admin/poc", label: "POC directory" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/outbox", label: "Emails" },
];

export default function NavBar({ email, isAdmin, active }: { email: string; isAdmin: boolean; active: string }) {
  const tabs = isAdmin ? [...TABS, ...ADMIN_TABS] : TABS;
  return (
    <nav className="nav" aria-label="Main">
      <div className="wrap">
        <span className="brand">Peak Shift Tracker</span>
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="tab" aria-current={active === t.href ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
        <span className="who">
          {email}
          <LogoutButton />
        </span>
      </div>
    </nav>
  );
}
