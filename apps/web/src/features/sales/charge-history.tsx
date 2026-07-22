"use client";

import type { PaginatedDto, PixChargeHistoryItemDto, PixChargeStatusDto } from "@bitpix/contracts";
import { Eye, Printer, RefreshCw, Search, X } from "lucide-react";
import Image from "next/image";
import { useState, type FormEvent } from "react";
import { PrintReceipt } from "@/components/print-receipt";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const labels: Record<PixChargeStatusDto, string> = { CREATING: "Criando", WAITING_PAYMENT: "Aguardando", PROCESSING: "Processando", PAID: "Pago", EXPIRED: "Expirado", CANCELLED: "Cancelado", REFUNDED: "Reembolsado", PARTIALLY_REFUNDED: "Reembolso parcial", FAILED: "Falhou", VALUE_MISMATCH: "Valor divergente", UNDER_REVIEW: "Em análise" };

interface Detail {
  publicId: string; saleCode: string; amount: string; receivedAmount: string | null; status: PixChargeStatusDto; createdAt: string; expiresAt: string; paidAt: string | null;
  providerOrderIdMasked: string | null; providerPaymentIdMasked: string | null; operator: { name: string }; cashRegister: { code: string; name: string };
  history: Array<{ status: PixChargeStatusDto; previousStatus: PixChargeStatusDto | null; source: string; reason: string | null; createdAt: string }>;
  payment: { publicId: string; status: string } | null;
  webhooks: Array<{ publicId: string; status: string; signatureStatus: string; processingError: string | null; receivedAt: string }>;
}

interface PrintData {
  title: string;
  storeName: string;
  saleCode: string;
  amount: string;
  paidAt?: string;
  providerPaymentIdMasked?: string | null;
  operator?: string;
  cashRegister?: string;
  qrCodeBase64?: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, { ...init, credentials: "include", headers: { "content-type": "application/json", ...init?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(body?.error?.message ?? "Não foi possível concluir a operação."); }
  return response.json() as Promise<T>;
}

export function ChargeHistory({ initial, canReconcile }: { initial: PaginatedDto<PixChargeHistoryItemDto>; canReconcile: boolean }) {
  const [result, setResult] = useState(initial);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [printData, setPrintData] = useState<PrintData | null>(null);

  const load = async (page = 1) => {
    setBusy(true); setError("");
    try { setResult(await request<PaginatedDto<PixChargeHistoryItemDto>>(`/pix/charges?page=${page}&pageSize=20&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ""}`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao consultar."); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void load(1); };
  const openDetail = async (publicId: string) => { setBusy(true); try { const body = await request<{ data: Detail }>(`/pix/charges/${publicId}/details`); setDetail(body.data); } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao abrir cobrança."); } finally { setBusy(false); } };
  const reconcile = async () => { if (!detail) return; setBusy(true); try { await request(`/pix/charges/${detail.publicId}/reconcile`, { method: "POST" }); await openDetail(detail.publicId); await load(result.pagination.page); } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao reconciliar."); } finally { setBusy(false); } };
  const print = async () => {
    if (!detail) return;
    try {
      if (detail.payment) {
        const body = await request<{ data: { receipt: PrintData } }>(`/pix/payments/${detail.payment.publicId}/receipt`, { method: "POST", body: JSON.stringify({ paperWidth: "MM80" }) });
        setPrintData(body.data.receipt);
      } else {
        const body = await request<{ data: { charge: { saleCode: string; amount: string; qrCodeBase64: string | null } } }>(`/pix/charges/${detail.publicId}/print`, { method: "POST", body: JSON.stringify({ paperWidth: "MM80" }) });
        setPrintData({ title: "Cobrança Pix", storeName: "BitPix", saleCode: body.data.charge.saleCode, amount: body.data.charge.amount, qrCodeBase64: body.data.charge.qrCodeBase64 });
      }
      document.documentElement.dataset.receiptWidth = "MM80";
      window.setTimeout(() => window.print(), 80);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao imprimir."); }
  };

  return <div className="space-y-5">
    <form className="card history-filters" onSubmit={submit}><div><label className="field-label" htmlFor="history-search">Buscar</label><div className="history-search"><Search size={17} /><input id="history-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, cobrança ou transação" /></div></div><div><label className="field-label" htmlFor="history-status">Status</label><select id="history-status" className="field-input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><button className="primary-button" disabled={busy}><Search size={17} /> Consultar</button></form>
    {error && <div className="cash-notice cash-notice-error" role="alert">{error}</div>}
    <section className="card cash-movements"><div className="cash-table-wrap"><table><thead><tr><th>Código</th><th>Data</th><th>Status</th><th>Operador / Caixa</th><th>ID Mercado Pago</th><th className="cash-value-column">Valor</th><th>Ações</th></tr></thead><tbody>{result.data.map((item) => <tr key={item.publicId}><td><strong>{item.saleCode}</strong></td><td>{dateTime.format(new Date(item.createdAt))}</td><td><span className={`pix-status pix-status-${item.status.toLowerCase()}`}>{labels[item.status]}</span></td><td>{item.operator}<small>{item.cashRegister}</small></td><td>{item.providerPaymentIdMasked ?? "—"}</td><td className="cash-value-column">{brl.format(Number(item.amount))}</td><td><button type="button" className="cash-secondary-button" onClick={() => void openDetail(item.publicId)}><Eye size={16} /> Visualizar</button></td></tr>)}</tbody></table></div>{result.data.length === 0 && <p className="cash-empty">Nenhuma cobrança encontrada.</p>}<div className="cash-pagination"><button type="button" disabled={result.pagination.page <= 1 || busy} onClick={() => void load(result.pagination.page - 1)}>Anterior</button><span>Página {result.pagination.page} de {Math.max(1, result.pagination.totalPages)}</span><button type="button" disabled={result.pagination.page >= result.pagination.totalPages || busy} onClick={() => void load(result.pagination.page + 1)}>Próxima</button></div></section>
    {detail && <div className="history-modal" role="dialog" aria-modal="true" aria-label="Detalhes da cobrança"><div className="card history-detail"><div className="cash-panel-heading"><div><p className="cash-kicker">Cobrança {detail.publicId.slice(0, 8)}</p><h2>{detail.saleCode}</h2></div><button className="icon-button" type="button" onClick={() => setDetail(null)} aria-label="Fechar"><X size={18} /></button></div><div className="history-detail-grid"><span>Valor <strong>{brl.format(Number(detail.amount))}</strong></span><span>Status <strong>{labels[detail.status]}</strong></span><span>Operador <strong>{detail.operator.name}</strong></span><span>Caixa <strong>{detail.cashRegister.code} · {detail.cashRegister.name}</strong></span><span>Criada em <strong>{dateTime.format(new Date(detail.createdAt))}</strong></span><span>Pago em <strong>{detail.paidAt ? dateTime.format(new Date(detail.paidAt)) : "—"}</strong></span><span>Order <strong>{detail.providerOrderIdMasked ?? "—"}</strong></span><span>Pagamento <strong>{detail.providerPaymentIdMasked ?? "—"}</strong></span></div><h3 className="mt-6 font-semibold">Histórico de status</h3><ol className="history-timeline">{detail.history.map((item, index) => <li key={`${item.createdAt}-${index}`}><span /><div><strong>{labels[item.status]}</strong><p>{item.reason ?? item.source}</p><small>{dateTime.format(new Date(item.createdAt))}</small></div></li>)}</ol><div className="pix-action-grid">{canReconcile && <button type="button" className="cash-secondary-button" onClick={() => void reconcile()} disabled={busy}><RefreshCw size={16} /> Consultar agora</button>}<button type="button" className="cash-secondary-button" onClick={() => void print()}><Printer size={16} /> {detail.payment ? "Imprimir comprovante" : "Reimprimir QR Code"}</button></div></div></div>}
    {printData && <PrintReceipt><h1>{printData.storeName}</h1><p>{printData.title}</p>{printData.qrCodeBase64 && <Image src={`data:image/png;base64,${printData.qrCodeBase64}`} width={420} height={420} unoptimized alt="" />}<strong>{brl.format(Number(printData.amount))}</strong><p>Venda {printData.saleCode}</p>{printData.providerPaymentIdMasked && <p>Transação {printData.providerPaymentIdMasked}</p>}{printData.operator && <p>Operador: {printData.operator}</p>}{printData.cashRegister && <p>Caixa: {printData.cashRegister}</p>}{printData.paidAt && <small>{dateTime.format(new Date(printData.paidAt))}</small>}<b>Pix · Documento não fiscal</b></PrintReceipt>}
  </div>;
}
