import LoginForm from "@/components/LoginForm";
import Logo from "@/components/Logo";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="narrow">
      <div style={{ margin: "24px 0 16px" }}>
        <Logo height={44} />
      </div>
      <div className="card stack">
        <h1>Peak Shift Tracker</h1>
        <p className="muted">Log in with your XB email. We will email you a 6-digit code.</p>
        <LoginForm />
      </div>
    </div>
  );
}
