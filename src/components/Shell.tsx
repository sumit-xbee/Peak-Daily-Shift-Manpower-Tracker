import { requireAdmin } from "@/lib/auth";

/**
 * Wraps a page's content. For admin-only pages it asks the database whether the visitor is a
 * SYSTEM_ADMIN; anyone else is sent to the dashboard before any admin data is read.
 * (The navigation bar lives in the section layout, so it does not reload between tabs.)
 */
export default async function Shell({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean; active?: string }) {
  if (adminOnly) await requireAdmin();
  return <>{children}</>;
}
