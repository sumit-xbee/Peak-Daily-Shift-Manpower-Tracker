import AppFrame from "@/components/AppFrame";
import { requireAdmin } from "@/lib/auth";

// Admin section: POC directory, Settings, Emails. Only a SYSTEM_ADMIN gets past this point.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <AppFrame>{children}</AppFrame>;
}
