import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RefundQueue, type RefundRow } from "@/features/refunds/refund-queue";
import { landingPathFor } from "@/lib/landing";
import { apiFetch, requireSession } from "@/lib/server-api";

export const metadata: Metadata = { title: "Estornos" };

export default async function RefundsPage() {
  const principal = await requireSession();
  // Fila de decisão é exclusiva de quem executa estornos (admin).
  if (!principal.permissions.includes("pix.refund.create")) redirect(landingPathFor(principal.permissions));
  const pending = (await apiFetch<{ data: RefundRow[]; meta: { pending: number } }>("/pix/refunds?status=REQUESTED&pageSize=50")).data;

  return (
    <div className="page-container management-page">
      <div className="management-heading">
        <div>
          <p className="eyebrow">Gestão financeira</p>
          <h1 className="display-title">Estornos pendentes</h1>
          <p>Solicitações dos atendentes aguardando sua decisão. Aprovar executa o estorno no Mercado Pago; negar cancela sem cobrar.</p>
        </div>
      </div>
      <RefundQueue initial={pending} />
    </div>
  );
}
