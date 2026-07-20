import { ArrowDownRight, ArrowUpRight, Banknote, CircleDollarSign, Clock3, Hourglass, Receipt, RotateCcw, Store, WalletCards } from "lucide-react";
import { redirect } from "next/navigation";
import { apiFetch, requireSession } from "@/lib/server-api";

interface Dashboard {
  period: { label: string; timezone: string };
  primary: { received: string; confirmedPayments: number; averageTicket: string; pendingCharges: number; previousReceived: string; receivedVariationPercent: number | null; trend: "UP" | "DOWN" | "NEUTRAL" };
  secondary: { monthReceived: string; expiredCharges: number; cancelledCharges: number; refunds: string; conversionRate: number | null; averagePaymentSeconds: number | null; valueMismatches: number; openCashRegisters: number };
  charts: { revenueByDay: Array<{ label: string; amount: string; count: number }>; statusDistribution: Array<{ status: string; count: number }>; branches: Array<{ publicId: string; name: string; amount: string; count: number }> };
  recentPayments: Array<{ publicId: string; saleCode: string; amount: string; operator: string; branch: string; paidAt: string }>;
}
const money = (value: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ preset?: string }> }) {
  const principal = await requireSession(); if (!principal.permissions.includes("dashboard.read")) redirect("/nova-venda");
  const requested = (await searchParams).preset; const preset = ["today", "7d", "30d", "current_month"].includes(requested ?? "") ? requested! : "7d";
  const dashboard = (await apiFetch<{ data: Dashboard }>(`/dashboard/summary?preset=${preset}`)).data;
  const max = Math.max(...dashboard.charts.revenueByDay.map((item) => Number(item.amount)), 1);
  const metrics = [
    { label: "Total recebido", value: money(dashboard.primary.received), note: dashboard.primary.receivedVariationPercent === null ? "Sem base anterior" : `${Math.abs(dashboard.primary.receivedVariationPercent)}% vs. período anterior`, icon: CircleDollarSign, trend: dashboard.primary.trend },
    { label: "Pagamentos", value: String(dashboard.primary.confirmedPayments), note: "Confirmações reais", icon: Receipt },
    { label: "Ticket médio", value: money(dashboard.primary.averageTicket), note: "Por pagamento confirmado", icon: Banknote },
    { label: "Cobranças pendentes", value: String(dashboard.primary.pendingCharges), note: "Aguardando conclusão", icon: Hourglass },
  ];
  return <div className="page-container management-page">
    <div className="management-heading"><div><p className="eyebrow">Visão da operação</p><h1 className="display-title">Dashboard</h1><p>Indicadores reais de {principal.company.displayName}, no fuso {dashboard.period.timezone}.</p></div><nav className="period-tabs" aria-label="Período">{[["today","Hoje"],["7d","7 dias"],["30d","30 dias"],["current_month","Mês"]].map(([key,label]) => <a key={key} data-active={preset === key} href={`/dashboard?preset=${key}`}>{label}</a>)}</nav></div>
    <section className="metric-grid">{metrics.map((item) => { const Icon = item.icon; return <article className="card metric-card" key={item.label}><span><Icon size={20}/></span><p>{item.label}</p><strong>{item.value}</strong><small className={item.trend === "DOWN" ? "negative" : ""}>{item.trend === "UP" ? <ArrowUpRight size={14}/> : item.trend === "DOWN" ? <ArrowDownRight size={14}/> : null}{item.note}</small></article>; })}</section>
    <section className="dashboard-grid">
      <article className="card chart-card"><div className="section-heading"><div><h2>Recebimentos</h2><p>{dashboard.period.label}</p></div><strong>{money(dashboard.primary.received)}</strong></div>{dashboard.charts.revenueByDay.length ? <div className="bar-chart">{dashboard.charts.revenueByDay.map((item) => <div className="bar-column" key={item.label} title={`${item.label}: ${money(item.amount)}`}><span style={{ height: `${Math.max(4, Number(item.amount) / max * 100)}%` }}/><small>{item.label.slice(5).replace("-","/")}</small></div>)}</div> : <Empty label="Nenhum pagamento confirmado no período." />}</article>
      <article className="card snapshot-card"><div className="section-heading"><div><h2>Resumo operacional</h2><p>Sinais para acompanhamento</p></div></div><dl><Fact icon={WalletCards} label="Recebido no mês" value={money(dashboard.secondary.monthReceived)}/><Fact icon={Store} label="Caixas abertos" value={String(dashboard.secondary.openCashRegisters)}/><Fact icon={Clock3} label="Tempo médio de pagamento" value={dashboard.secondary.averagePaymentSeconds === null ? "—" : `${dashboard.secondary.averagePaymentSeconds}s`}/><Fact icon={RotateCcw} label="Reembolsos" value={money(dashboard.secondary.refunds)}/></dl></article>
    </section>
    <section className="card data-card"><div className="section-heading"><div><h2>Pagamentos recentes</h2><p>Últimas confirmações no período</p></div><a href="/historico">Ver histórico</a></div>{dashboard.recentPayments.length ? <div className="table-scroll"><table><thead><tr><th>Venda</th><th>Filial</th><th>Operador</th><th>Horário</th><th>Valor</th></tr></thead><tbody>{dashboard.recentPayments.map((item) => <tr key={item.publicId}><td><strong>{item.saleCode}</strong></td><td>{item.branch}</td><td>{item.operator}</td><td>{new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:dashboard.period.timezone}).format(new Date(item.paidAt))}</td><td><strong>{money(item.amount)}</strong></td></tr>)}</tbody></table></div> : <Empty label="Nenhum pagamento confirmado no período." />}</section>
  </div>;
}
function Fact({ icon: Icon, label, value }: { icon: typeof Store; label: string; value: string }) { return <div><dt><span><Icon size={17}/></span>{label}</dt><dd>{value}</dd></div>; }
function Empty({ label }: { label: string }) { return <div className="empty-state"><Receipt size={24}/><p>{label}</p></div>; }
