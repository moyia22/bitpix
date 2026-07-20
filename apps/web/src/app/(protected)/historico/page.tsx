import type { PaginatedDto, PixChargeHistoryItemDto } from "@bitpix/contracts";
import type { Metadata } from "next";
import { ChargeHistory } from "@/features/sales/charge-history";
import { apiFetch, requireSession } from "@/lib/server-api";

export const metadata: Metadata = { title: "Histórico" };

export default async function HistoryPage() {
  const [initial, session] = await Promise.all([apiFetch<PaginatedDto<PixChargeHistoryItemDto>>("/pix/charges?page=1&pageSize=20"), requireSession()]);
  return <div className="page-container"><div className="mb-8"><span className="dev-badge mb-4"><span className="status-dot" /> Desenvolvimento</span><h1 className="display-title">Histórico</h1><p className="mt-2 text-[var(--ink-muted)]">Cobranças reais e simuladas, sem misturar dados entre empresas.</p></div><ChargeHistory initial={initial} canReconcile={session.permissions.includes("pix.charge.reconcile")} /></div>;
}
