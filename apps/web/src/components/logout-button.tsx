"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await fetch(`${apiUrl}/api/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      window.location.assign("/login");
    }
  };

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] disabled:opacity-50"
    >
      <LogOut size={18} aria-hidden="true" />
      {busy ? "Saindo..." : "Sair com segurança"}
    </button>
  );
}
