"use client";

import type { ApiErrorBody, CashSessionDto, PixChargeDto } from "@bitpix/contracts";
import { ArrowLeft, Calculator, Check, CircleCheckBig, Clipboard, CornerDownLeft, Delete, ExternalLink, Printer, Radio, RotateCcw, ScanLine, ShieldAlert, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { PrintReceipt } from "@/components/print-receipt";

const moneyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

interface Readiness {
  configured: boolean;
  status: string;
  providerMode: "real" | "mock";
  lastVerifiedAt: string | null;
}

const statusLabels: Record<PixChargeDto["status"], string> = {
  CREATING: "Criando cobrança",
  WAITING_PAYMENT: "Aguardando pagamento",
  PROCESSING: "Processando",
  PAID: "Pago",
  EXPIRED: "Expirado",
  CANCELLED: "Cancelado",
  REFUNDED: "Estornado",
  PARTIALLY_REFUNDED: "Estorno parcial",
  FAILED: "Falhou",
  VALUE_MISMATCH: "Valor divergente",
  UNDER_REVIEW: "Em análise",
};

async function parseError(response: Response): Promise<{ message: string; details?: { existingChargePublicId?: string; chargePublicId?: string } }> {
  const body = await response.json() as ApiErrorBody;
  const details = body.error?.details as { existingChargePublicId?: string; chargePublicId?: string } | undefined;
  return { message: body.error?.message ?? "Não foi possível concluir a operação.", ...(details ? { details } : {}) };
}

export function NewSaleForm({ currentCash, readiness }: { currentCash: CashSessionDto | null; readiness: Readiness }) {
  const codeRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [amountInCents, setAmountInCents] = useState(0);
  const [charge, setCharge] = useState<PixChargeDto | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [paperWidth, setPaperWidth] = useState<"MM58" | "MM80">("MM80");
  const [keypadOpen, setKeypadOpen] = useState(true);
  const [clock, setClock] = useState(0);
  const [connectionState, setConnectionState] = useState<"idle" | "live" | "polling">("idle");
  const [paymentReceipt, setPaymentReceipt] = useState<Record<string, string> | null>(null);
  const confirmationPlayedRef = useRef<string | null>(null);
  const chargePublicId = charge?.publicId;
  const chargeStatus = charge?.status;

  useEffect(() => codeRef.current?.focus(), []);
  useEffect(() => {
    if (!charge || ["PAID", "EXPIRED", "CANCELLED", "FAILED"].includes(charge.status)) return;
    const timer = window.setInterval(() => setClock(new Date().getTime()), 1_000);
    return () => window.clearInterval(timer);
  }, [charge]);

  const handleCodeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); amountRef.current?.focus(); }
  };
  const updateAmount = (rawValue: string) => setAmountInCents(Number(rawValue.replace(/\D/g, "").slice(0, 9) || 0));
  const addAmount = (cents: number) => { setAmountInCents((previous) => Math.min(previous + cents, 99_999_999)); amountRef.current?.focus(); };
  const clearAmount = () => { setAmountInCents(0); amountRef.current?.focus(); };
  const pushDigit = (digit: number) => { setAmountInCents((previous) => Math.min(previous * 10 + digit, 99_999_999)); amountRef.current?.focus(); };
  const pushDoubleZero = () => { setAmountInCents((previous) => Math.min(previous * 100, 99_999_999)); amountRef.current?.focus(); };
  const backspaceAmount = () => { setAmountInCents((previous) => Math.floor(previous / 10)); amountRef.current?.focus(); };
  const quickAmounts = [500, 1000, 2000, 5000, 10000];

  const loadCharge = useCallback(async (publicId: string) => {
    const response = await fetch(`${apiUrl}/api/v1/pix/charges/${publicId}`, { credentials: "include", headers: { "x-bitpix-polling": "true" } });
    if (!response.ok) throw new Error((await parseError(response)).message);
    const body = await response.json() as { data: PixChargeDto };
    setCharge(body.data);
  }, []);

  useEffect(() => {
    if (!chargePublicId || !chargeStatus || ["PAID", "EXPIRED", "CANCELLED", "FAILED", "REFUNDED"].includes(chargeStatus)) return;
    let disposed = false;
    let pollingTimer: number | undefined;
    let pollingDelay = 5_000;
    const source = new EventSource(`${apiUrl}/api/v1/pix/charges/${chargePublicId}/events`, { withCredentials: true });
    const receive = () => { if (!disposed) void loadCharge(chargePublicId); };
    const eventNames = ["charge.waiting_payment", "charge.processing", "charge.paid", "charge.expired", "charge.cancelled", "charge.failed", "charge.value_mismatch", "charge.refunded", "charge.under_review"];
    eventNames.forEach((name) => source.addEventListener(name, receive));
    source.onopen = () => setConnectionState("live");
    const poll = async () => {
      if (disposed) return;
      if (document.visibilityState === "visible") await loadCharge(chargePublicId).catch(() => undefined);
      pollingDelay = Math.min(15_000, Math.round(pollingDelay * 1.45));
      pollingTimer = window.setTimeout(() => void poll(), pollingDelay);
    };
    source.onerror = () => { source.close(); setConnectionState("polling"); if (!pollingTimer) pollingTimer = window.setTimeout(() => void poll(), pollingDelay); };
    return () => { disposed = true; source.close(); if (pollingTimer) window.clearTimeout(pollingTimer); };
  }, [chargePublicId, chargeStatus, loadCharge]);

  useEffect(() => {
    if (!charge || charge.status !== "PAID" || confirmationPlayedRef.current === charge.publicId || !charge.companyPaymentSoundEnabled) return;
    confirmationPlayedRef.current = charge.publicId;
    if (window.localStorage.getItem("bitpix-payment-sound") === "off") return;
    try {
      const AudioContextClass = window.AudioContext;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 740; gain.gain.setValueAtTime(0.04, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.18);
    } catch { /* confirmação visual continua disponível quando autoplay é bloqueado */ }
  }, [charge]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentCash || !readiness.configured || !code.trim() || amountInCents <= 0) return;
    setError(""); setSubmitting(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/pix/charges`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim(), amountInCents }),
      });
      if (!response.ok) {
        const failure = await parseError(response);
        const existingId = failure.details?.existingChargePublicId ?? failure.details?.chargePublicId;
        if (existingId) { await loadCharge(existingId); return; }
        throw new Error(failure.message);
      }
      const body = await response.json() as { data: PixChargeDto };
      setCharge(body.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar o Pix.");
    } finally { setSubmitting(false); }
  };

  const copyCode = async () => {
    if (!charge?.qrCodeText) return;
    await navigator.clipboard.writeText(charge.qrCodeText);
    await fetch(`${apiUrl}/api/v1/pix/charges/${charge.publicId}/copy`, { method: "POST", credentials: "include" });
    setCopied(true); window.setTimeout(() => setCopied(false), 2_000);
  };

  const cancelCharge = async () => {
    if (!charge) return;
    setError("");
    const response = await fetch(`${apiUrl}/api/v1/pix/charges/${charge.publicId}/cancel`, { method: "POST", credentials: "include" });
    if (!response.ok) { setError((await parseError(response)).message); return; }
    const body = await response.json() as { data: PixChargeDto }; setCharge(body.data);
  };

  const printCharge = async () => {
    if (!charge) return;
    const response = await fetch(`${apiUrl}/api/v1/pix/charges/${charge.publicId}/print`, {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ paperWidth }),
    });
    if (!response.ok) { setError((await parseError(response)).message); return; }
    document.documentElement.dataset.receiptWidth = paperWidth;
    setPrintOpen(false);
    window.setTimeout(() => window.print(), 80);
  };

  const printPaymentReceipt = async () => {
    if (!charge?.paymentPublicId) return;
    const response = await fetch(`${apiUrl}/api/v1/pix/payments/${charge.paymentPublicId}/receipt`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ paperWidth }) });
    if (!response.ok) { setError((await parseError(response)).message); return; }
    const body = await response.json() as { data: { receipt: Record<string, string> } };
    setPaymentReceipt(body.data.receipt);
    document.documentElement.dataset.receiptWidth = paperWidth;
    document.documentElement.dataset.receiptKind = "payment";
    setPrintOpen(false);
    window.setTimeout(() => window.print(), 80);
    return body.data.receipt;
  };

  const newSale = () => { setCharge(null); setCode(""); setAmountInCents(0); setError(""); setConnectionState("idle"); window.setTimeout(() => codeRef.current?.focus(), 0); };
  const remainingSeconds = charge && clock > 0 ? Math.max(0, Math.floor((new Date(charge.expiresAt).getTime() - clock) / 1_000)) : 0;
  const remaining = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const trackingComplete = Boolean(charge && ["PAID", "EXPIRED", "CANCELLED", "FAILED", "REFUNDED"].includes(charge.status));

  if (charge) {
    if (charge.status === "PAID") {
      return (
        <div className="pix-result pix-paid-result">
          <div className="pix-paid-icon"><CircleCheckBig size={42} /></div>
          <p className="cash-kicker">Liquidação validada no provedor</p>
          <h2>Pagamento confirmado</h2>
          <p className="pix-paid-value">{moneyFormatter.format(Number(charge.receivedAmount ?? charge.amount))}</p>
          <div className="pix-reference"><span>Código da venda</span><strong>{charge.saleCode}</strong><span>Confirmado em</span><strong>{charge.paidAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(charge.paidAt)) : "Agora"}</strong><span>Transação</span><strong>{charge.providerPaymentIdMasked ?? "Protegida"}</strong></div>
          <div className="pix-action-grid"><button type="button" className="cash-secondary-button" onClick={() => setPrintOpen(true)}><Printer size={17} /> Imprimir comprovante</button><button type="button" className="primary-button" onClick={newSale}><RotateCcw size={17} /> Nova venda</button></div>
          {printOpen && <div className="pix-print-panel" role="dialog" aria-modal="true" aria-label="Imprimir comprovante"><div><strong>Largura do papel</strong><button type="button" onClick={() => setPrintOpen(false)} aria-label="Fechar"><X size={18} /></button></div><div className="pix-paper-options"><button type="button" data-active={paperWidth === "MM58"} onClick={() => setPaperWidth("MM58")}>58 mm</button><button type="button" data-active={paperWidth === "MM80"} onClick={() => setPaperWidth("MM80")}>80 mm</button></div><button className="primary-button w-full" type="button" onClick={() => void printPaymentReceipt()}><Printer size={18} /> Imprimir comprovante</button></div>}
          <PrintReceipt><h1>{paymentReceipt?.storeName ?? "BitPix"}</h1><p>{paymentReceipt?.title ?? "Pagamento confirmado"}</p><strong>{moneyFormatter.format(Number(paymentReceipt?.amount ?? charge.receivedAmount ?? charge.amount))}</strong><p>Venda {paymentReceipt?.saleCode ?? charge.saleCode}</p><p>Transação {paymentReceipt?.providerPaymentIdMasked ?? charge.providerPaymentIdMasked}</p><p>Operador: {paymentReceipt?.operator ?? "Registrado no sistema"}</p><p>Caixa: {paymentReceipt?.cashRegister ?? charge.cashRegister.name}</p><small>{paymentReceipt?.paidAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(paymentReceipt.paidAt)) : ""}</small><b>{paymentReceipt?.paymentMethod ?? "Pix"} · {paymentReceipt?.disclaimer ?? "Documento não fiscal"}</b></PrintReceipt>
        </div>
      );
    }
    return (
      <div className="pix-result">
        {charge.providerMode === "mock" && <div className="mock-provider-banner">Ambiente simulado — este QR Code não realiza pagamentos</div>}
        <div className="pix-result-heading">
          <div><p className="cash-kicker">Pix gerado</p><h2>{statusLabels[charge.status]}</h2></div>
          <span className={`pix-status pix-status-${charge.status.toLowerCase()}`}>{statusLabels[charge.status]}</span>
        </div>
        <div className="pix-live-state"><Radio size={15} /> {trackingComplete ? "Acompanhamento concluído" : connectionState === "live" ? "Atualização em tempo real conectada" : connectionState === "polling" ? "Acompanhamento por contingência" : "Conectando atualização em tempo real"}</div>
        {charge.status === "VALUE_MISMATCH" && <div className="cash-notice cash-notice-error"><ShieldAlert size={19} /><span><strong>Valor recebido divergente.</strong><br />Não entregue a venda. Solicite análise de um administrador.</span></div>}
        {charge.qrCodeBase64 && (
          <div className="pix-qr-shell">
            <Image src={`data:image/png;base64,${charge.qrCodeBase64}`} width={320} height={320} unoptimized alt="QR Code da cobrança Pix" priority />
          </div>
        )}
        <div className="pix-amount-line"><span>Valor</span><strong>{moneyFormatter.format(Number(charge.amount))}</strong></div>
        <div className="pix-reference"><span>Código</span><strong>{charge.saleCode}</strong><span>Expira em</span><strong className="tabular-nums">{remaining}</strong></div>
        <button className="primary-button w-full" type="button" onClick={() => void copyCode()} disabled={!charge.qrCodeText}>
          {copied ? <Check size={19} /> : <Clipboard size={19} />}{copied ? "Código copiado" : "Copiar código Pix"}
        </button>
        <div className="pix-action-grid">
          <button type="button" className="cash-secondary-button" onClick={() => setPrintOpen(true)}><Printer size={17} /> Imprimir</button>
          {charge.ticketUrl && <a className="cash-secondary-button" href={charge.ticketUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Abrir no provedor</a>}
          {charge.canCancel && <button type="button" className="cash-secondary-button danger-action" onClick={() => void cancelCharge()}><X size={17} /> Cancelar</button>}
          <button type="button" className="cash-secondary-button" onClick={newSale}><RotateCcw size={17} /> Nova cobrança</button>
        </div>
        {error && <div role="alert" className="cash-notice cash-notice-error">{error}</div>}

        {printOpen && <div className="pix-print-panel" role="dialog" aria-modal="true" aria-label="Imprimir cobrança"><div><strong>Largura do papel</strong><button type="button" onClick={() => setPrintOpen(false)} aria-label="Fechar"><X size={18} /></button></div><div className="pix-paper-options"><button type="button" data-active={paperWidth === "MM58"} onClick={() => setPaperWidth("MM58")}>58 mm</button><button type="button" data-active={paperWidth === "MM80"} onClick={() => setPaperWidth("MM80")}>80 mm</button></div><button className="primary-button w-full" type="button" onClick={() => void printCharge()}><Printer size={18} /> Imprimir cobrança</button></div>}

        <PrintReceipt>
          <h1>BitPix</h1><p>Cobrança Pix</p>
          {charge.qrCodeBase64 && <Image src={`data:image/png;base64,${charge.qrCodeBase64}`} width={420} height={420} unoptimized alt="" />}
          <strong>{moneyFormatter.format(Number(charge.amount))}</strong><p>{charge.saleCode}</p><small>Gerado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(charge.createdAt))}</small>
          {charge.providerMode === "mock" && <b>SEM VALOR — AMBIENTE SIMULADO</b>}
        </PrintReceipt>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-6">
      {readiness.providerMode === "mock" && <div className="mock-provider-banner">Provedor em modo simulado — nenhum pagamento real será criado</div>}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3"><label className="field-label mb-0" htmlFor="sale-code">Código de identificação</label><span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-faint)]"><ScanLine size={15} /> Leitor compatível</span></div>
        <input ref={codeRef} className="field-input text-lg font-semibold uppercase tracking-[0.02em]" id="sale-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\s+/g, " ").slice(0, 64))} onKeyDown={handleCodeKeyDown} autoComplete="off" maxLength={64} placeholder="Ex.: PED-1048" required />
        <p className="mt-2 text-sm text-[var(--ink-faint)]">Pedido, comanda ou código do seu sistema.</p>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="field-label mb-0" htmlFor="sale-amount">Valor da venda</label>
          <div className="flex items-center gap-3">
            <button type="button" className="amount-clear" onClick={() => setKeypadOpen((open) => !open)} aria-pressed={keypadOpen}><Calculator size={14} /> Teclado</button>
            {amountInCents > 0 && (
              <button type="button" className="amount-clear" onClick={clearAmount}><X size={14} /> Limpar</button>
            )}
          </div>
        </div>
        <input
          ref={amountRef}
          className="field-input amount-input h-16 text-right font-[var(--font-display)] text-3xl font-semibold tracking-[-0.025em]"
          id="sale-amount"
          inputMode="numeric"
          value={moneyFormatter.format(amountInCents / 100)}
          onChange={(event) => updateAmount(event.target.value)}
          data-empty={amountInCents === 0}
          autoComplete="off"
          required
          aria-label="Valor da venda em reais"
        />
        <div className="amount-chips" role="group" aria-label="Adicionar valores rápidos">
          {quickAmounts.map((cents) => (
            <button type="button" key={cents} className="amount-chip" onClick={() => addAmount(cents)}>
              + {moneyFormatter.format(cents / 100)}
            </button>
          ))}
        </div>
        {keypadOpen && (
          <div className="keypad" role="group" aria-label="Teclado numérico">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <button type="button" key={digit} className="keypad-key" onClick={() => pushDigit(digit)}>{digit}</button>
            ))}
            <button type="button" className="keypad-key keypad-key--muted" onClick={pushDoubleZero}>00</button>
            <button type="button" className="keypad-key" onClick={() => pushDigit(0)}>0</button>
            <button type="button" className="keypad-key keypad-key--muted" onClick={backspaceAmount} aria-label="Apagar último dígito"><Delete size={20} /></button>
          </div>
        )}
        <p className="mt-2 text-sm text-[var(--ink-faint)]">Toque nos números ou use os atalhos. Os dois últimos dígitos são os centavos — <strong className="text-[var(--ink-muted)]">1250</strong> vira <strong className="text-[var(--ink-muted)]">R$ 12,50</strong>.</p>
      </div>
      {!readiness.configured && <div className="cash-notice cash-notice-error"><span><strong>Mercado Pago não está pronto.</strong><br />Configure e teste a integração antes de cobrar.</span><Link href="/configuracoes/integracoes/mercado-pago" className="cash-secondary-button"><ArrowLeft size={16} /> Configurar</Link></div>}
      {error && <div role="alert" className="cash-notice cash-notice-error">{error}</div>}
      {!currentCash && <div className="rounded-xl border border-[color-mix(in_srgb,var(--warning)_28%,var(--border))] bg-[var(--warning-soft)] px-4 py-3.5 text-sm text-[var(--ink)]"><strong className="block">Abra o caixa antes de gerar uma cobrança.</strong><Link href="/caixa" className="mt-2 inline-flex font-bold text-[var(--warning)]">Abrir caixa →</Link></div>}
      <button className="primary-button w-full" type="submit" disabled={!currentCash || !readiness.configured || !code.trim() || amountInCents <= 0 || submitting}>{submitting ? "Gerando Pix…" : "Gerar Pix"}<span className="ml-auto flex items-center gap-1 rounded-md bg-white/14 px-2 py-1 text-[0.72rem] font-semibold"><CornerDownLeft size={13} /> Enter</span></button>
    </form>
  );
}
