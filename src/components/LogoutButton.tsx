"use client";

import { postJson } from "@/lib/client";

export default function LogoutButton() {
  return (
    <button
      className="btn secondary small"
      onClick={async () => {
        await postJson("/api/auth/logout", {}); // even if this fails, leave: the cookie expires on its own
        window.location.href = "/login";
      }}
    >
      Log out
    </button>
  );
}
