import LoginForm from "@/components/LoginForm";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="narrow">
      <div className="card stack">
        <h1>Peak Shift Tracker</h1>
        <p className="muted">Log in with your XB email. We will email you a 6-digit code.</p>
        <LoginForm />
      </div>
    </div>
  );
}
