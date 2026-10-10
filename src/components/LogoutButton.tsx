"use client";

export default function LogoutButton() {
  return (
    <button
      className="btn secondary small"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      Log out
    </button>
  );
}
