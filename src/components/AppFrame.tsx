import { isAdminEmail, requireSession } from "@/lib/auth";
import NavBar from "./NavBar";

/** The frame around every logged-in page: one navigation bar that stays put while pages change. */
export default async function AppFrame({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const admin = s.admin ?? (await isAdminEmail(s.email));
  return (
    <>
      <NavBar email={s.email} isAdmin={admin} />
      <main className="wrap">{children}</main>
    </>
  );
}
