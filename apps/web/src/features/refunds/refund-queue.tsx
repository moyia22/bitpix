"use client";

import { Check, LoaderCircle, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/toaster";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export interface RefundRow {
  publicId: string;
  status: string;
  amount: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  processedAt: string | null;
  saleCode: string;
  description: string | null;
  cashRegister: string;
  chargePublicId: string;
  providerPaymentIdMasked: string | null;
}

const statusLabels: Record<string, string> = { REQUESTED: "Aguardando decisão", PROCESSING: "Processando", PROCESSED: "Estornado", FAILED: "Falhou", CANCELLED: "Negado" };

export function RefundQueue({ initial }: { initial: RefundRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const decide = async (publicId: string, action: "approve" | "deny") => {
    setBusyId(publicId); setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/pix/refunds/${publicId}/${action}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      if (!response.ok) { const body = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(body?.error?.message ?? "Não foi possível concluir."); }
      setRows((current) => current.filter((row) => row.publicId !== publicId));
      toast(action === "approve" ? "Estorno aprovado e enviado ao Mercado Pago." : "Solicitação de estorno negada.", action === "approve" ? "success" : "info");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao decidir o estorno."); } finally { setBusyId(null); }
  };

  if (rows.length === 0) {
    return <div className="card empty-state"><Undo2 size={28} /><p>Nenhum estorno aguardando decisão.</p></div>;
  }

  return (
    <>
      {error && <div className="cash-notice cash-notice-error" role="alert">{error}</div>}
      <div className="refund-queue">
        {rows.map((row) => (
          <article className="card refund-queue-card" key={row.publicId}>
            <div className="refund-queue-head">
              <div>
                <p className="cash-kicker">{statusLabels[row.status] ?? row.status}</p>
                <h2>{brl.format(Number(row.amount))}</h2>
              </div>
              <Link href={`/historico?open=${row.chargePublicId}`} className="cash-secondary-button">Ver venda</Link>
            </div>
            <dl className="refund-queue-facts">
              <div><dt>Venda</dt><dd>{row.saleCode}</dd></div>
              {row.description && <div><dt>Cliente/obs.</dt><dd>{row.description}</dd></div>}
              <div><dt>Solicitado por</dt><dd>{row.requestedBy}</dd></div>
              <div><dt>Caixa</dt><dd>{row.cashRegister}</dd></div>
              <div><dt>Quando</dt><dd>{dateTime.format(new Date(row.requestedAt))}</dd></div>
              <div><dt>Transação</dt><dd>{row.providerPaymentIdMasked ?? "—"}</dd></div>
            </dl>
            <p className="refund-queue-reason"><strong>Motivo:</strong> {row.reason}</p>
            <div className="refund-decide">
              <button type="button" className="primary-button" disabled={busyId !== null} onClick={() => void decide(row.publicId, "approve")}>{busyId === row.publicId ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Aprovar estorno</button>
              <button type="button" className="cash-secondary-button danger-action" disabled={busyId !== null} onClick={() => void decide(row.publicId, "deny")}><X size={16} /> Negar</button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
