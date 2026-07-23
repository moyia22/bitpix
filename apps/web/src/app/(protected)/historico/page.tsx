import type { PaginatedDto, PixChargeHistoryItemDto } from "@bitpix/contracts";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChargeHistory } from "@/features/sales/charge-history";
import { landingPathFor } from "@/lib/landing";
import { apiFetch, requireSession } from "@/lib/server-api";

export const metadata: Metadata = { title: "Histórico" };

export default async function HistoryPage() {
  const session = await requireSession();
  // Gate: sem permissão de consulta, segue para a primeira página utilizável.
  if (!session.permissions.includes("pix.charge.read")) redirect(landingPathFor(session.permissions));
  const initial = await apiFetch<PaginatedDto<PixChargeHistoryItemDto>>("/pix/charges?page=1&pageSize=20");
  return <div className="page-container"><div className="mb-8"><span className="dev-badge mb-4"><span className="status-dot" /> Desenvolvimento</span><h1 className="display-title">Histórico</h1><p className="mt-2 text-[var(--ink-muted)]">Cobranças reais e simuladas, sem misturar dados entre empresas.</p></div><ChargeHistory initial={initial} canReconcile={session.permissions.includes("pix.charge.reconcile")} /></div>;
}
