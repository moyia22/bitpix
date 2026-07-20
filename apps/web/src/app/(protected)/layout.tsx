import type { CashSessionDto } from "@bitpix/contracts";
import { AppShell } from "@/components/app-shell";
import { apiFetch, requireSession } from "@/lib/server-api";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const principal = await requireSession();
  const currentCash = principal.permissions.includes("cash.session.read")
    ? (await apiFetch<{ data: CashSessionDto | null }>("/cash-sessions/current")).data
    : null;
  return <AppShell principal={principal} currentCash={currentCash}>{children}</AppShell>;
}
