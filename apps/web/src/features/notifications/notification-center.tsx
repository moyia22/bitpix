"use client";
import { Bell, Check, CheckCheck, CheckCircle2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

type Notice = { publicId: string; type: string; status: string; title: string; message: string; entityType?: string; metadata?: { chargePublicId?: string } | null; createdAt: string };

// Rótulos amigáveis por tipo (fallback: humaniza o enum).
const typeLabels: Record<string, string> = {
  REFUND_REQUESTED: "Pedido de estorno",
  PAYMENT_CONFIRMED: "Pagamento confirmado",
  PAYMENT_VALUE_MISMATCH: "Valor divergente",
  PAYMENT_AFTER_CASH_CLOSE: "Pagamento após fechamento",
  WEBHOOK_UNRESOLVED: "Webhook pendente",
  WEBHOOK_DEAD_LETTER: "Webhook não processado",
  CASH_CLOSED_WITH_PENDING_CHARGES: "Caixa fechado com pendências",
  CASH_DISCREPANCY: "Divergência de caixa",
  EXPORT_COMPLETED: "Exportação concluída",
  EXPORT_FAILED: "Falha na exportação",
  INTEGRATION_UNAVAILABLE: "Integração indisponível",
  SUSPICIOUS_ACCESS: "Acesso suspeito",
  COMPANY_LIMIT_NEAR: "Limite do plano próximo",
  QUEUE_UNAVAILABLE: "Fila indisponível",
};

export function NotificationCenter({ notices, unread, canUpdate }: { notices: Notice[]; unread: number; canUpdate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const update = async (path: string) => { setBusy(true); try { await fetch(`${apiUrl}/api/v1${path}`, { method: "POST", credentials: "include" }); router.refresh(); } finally { setBusy(false); } };

  return <>
    <div className="notification-summary">
      <p>{unread} alerta{unread === 1 ? "" : "s"} não lido{unread === 1 ? "" : "s"}.</p>
      {canUpdate && unread > 0 && <button className="secondary-button" disabled={busy} onClick={() => void update("/notifications/read-all")}><CheckCheck /> Marcar todas como lidas</button>}
    </div>
    <section className="card notification-list">
      {notices.length ? notices.map((item) => {
        const isRefund = item.type === "REFUND_REQUESTED";
        const chargeLink = isRefund && item.metadata?.chargePublicId ? `/historico?open=${item.metadata.chargePublicId}` : null;
        return (
          <article key={item.publicId} data-read={item.status !== "OPEN"} data-kind={isRefund ? "refund" : undefined}>
            <span>{item.status === "RESOLVED" ? <CheckCircle2 /> : isRefund ? <Undo2 /> : <Bell />}</span>
            <div>
              <h2>{item.title}</h2>
              <p>{item.message}</p>
              <small>{typeLabels[item.type] ?? item.type.replaceAll("_", " ")} · {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))}</small>
              {chargeLink && <Link href={chargeLink} className="notification-link">Abrir venda para decidir →</Link>}
            </div>
            {canUpdate && item.status === "OPEN" && <button className="icon-button" title="Marcar como lida" disabled={busy} onClick={() => void update(`/notifications/${item.publicId}/read`)}><Check /></button>}
          </article>
        );
      }) : <div className="empty-state"><Bell /><p>Você não possui novas notificações.</p></div>}
    </section>
  </>;
}
