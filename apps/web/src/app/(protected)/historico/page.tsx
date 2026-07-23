import type { PaginatedDto, PixChargeHistoryItemDto } from "@bitpix/contracts";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChargeHistory } from "@/features/sales/charge-history";
import { landingPathFor } from "@/lib/landing";
import { apiFetch, requireSession } from "@/lib/server-api";

export const metadata: Metadata = { title: "Histórico" };

interface OperatorOption { publicId: string; name: string }

export default async function HistoryPage() {
  const session = await requireSession();
  // Gate: sem permissão de consulta, segue para a primeira página utilizável.
  if (!session.permissions.includes("pix.charge.read")) redirect(landingPathFor(session.permissions));
  const canFilterByOperator = session.permissions.includes("users.read") || session.permissions.includes("users.manage");
  const [initial, operators] = await Promise.all([
    apiFetch<PaginatedDto<PixChargeHistoryItemDto>>("/pix/charges?page=1&pageSize=20"),
    // Gestão admin: lista de atendentes para o filtro "atendente1 / atendente2 / geral".
    canFilterByOperator
      ? apiFetch<{ data: OperatorOption[] }>("/users?pageSize=50").then((body) => body.data.map((user) => ({ publicId: user.publicId, name: user.name })))
      : Promise.resolve<OperatorOption[]>([]),
  ]);
  return (
    <div className="page-container">
      <div className="mb-8"><h1 className="display-title">Histórico</h1><p className="mt-2 text-[var(--ink-muted)]">Todas as cobranças Pix da sua loja, com status acompanhado em tempo real.</p></div>
      <ChargeHistory
        initial={initial}
        canReconcile={session.permissions.includes("pix.charge.reconcile")}
        canRefund={session.permissions.includes("pix.refund.create")}
        operators={operators}
      />
    </div>
  );
}
