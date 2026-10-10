import { isAdminEmail, requireSession } from "@/lib/auth";
import NavBar from "./NavBar";

/** Page frame for logged-in pages: navigation plus content. */
export default async function Shell({ active, children, adminOnly = false }: { active: string; children: React.ReactNode; adminOnly?: boolean }) {
  const s = await requireSession();
  const admin = await isAdminEmail(s.email);
  return (
    <>
      <NavBar email={s.email} isAdmin={admin} active={active} />
      <main className="wrap">
        {adminOnly && !admin ? <div className="msg err">This page is for administrators only.</div> : children}
      </main>
    </>
  );
}
