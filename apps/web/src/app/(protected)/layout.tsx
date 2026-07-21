import type { CashSessionDto } from "@bitpix/contracts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { apiFetch, requireSession } from "@/lib/server-api";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const principal = await requireSession();
  const pathname = (await headers()).get("x-pathname") ?? "";

  // Portões pós-login: força configurar 2FA ou trocar a senha antes de usar o resto.
  if (principal.mfaEnrollmentPending && pathname !== "/configuracoes/seguranca") redirect("/configuracoes/seguranca");
  if (principal.mustResetPassword && pathname !== "/configuracoes/senha") redirect("/configuracoes/senha");

  const blocked = principal.mfaEnrollmentPending || principal.mustResetPassword;
  const currentCash = !blocked && principal.permissions.includes("cash.session.read")
    ? (await apiFetch<{ data: CashSessionDto | null }>("/cash-sessions/current")).data
    : null;
  return <AppShell principal={principal} currentCash={currentCash}>{children}</AppShell>;
}
