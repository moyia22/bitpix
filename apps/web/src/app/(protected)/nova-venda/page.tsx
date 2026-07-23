import type { CashSessionDto } from "@bitpix/contracts";
import type { Metadata } from "next";
import { Activity, CheckCircle2, Clock3, LockKeyhole, Radio } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NewSaleForm } from "@/features/sales/new-sale-form";
import { landingPathFor } from "@/lib/landing";
import { apiFetch, requireSession } from "@/lib/server-api";

export const metadata: Metadata = { title: "Nova venda" };

interface ActivityItem {
  publicId: string;
  action: string;
  outcome: "SUCCESS" | "FAILURE";
  createdAt: string;
  actor: { name: string } | null;
}

const activityLabels: Record<string, string> = {
  "auth.login.succeeded": "Acesso autorizado",
  "auth.login.failed": "Tentativa de acesso recusada",
  "auth.logout": "Sessão encerrada",
  "auth.sessions.revoked": "Outras sessões revogadas",
  "system.seed": "Ambiente inicializado",
  "branch.created": "Filial cadastrada",
  "user.created": "Usuário cadastrado",
  "cash.register.created": "Caixa cadastrado",
  "cash.register.updated": "Caixa atualizado",
  "cash.register.disabled": "Caixa desativado",
  "cash.session.opened": "Caixa aberto",
  "cash.movement.supplied": "Suprimento registrado",
  "cash.movement.withdrawn": "Sangria registrada",
  "cash.session.closed": "Caixa fechado",
  "pix.charge.created": "Cobrança Pix criada",
  "pix.charge.cancelled": "Cobrança Pix cancelada",
  "pix.charge.print_requested": "Impressão Pix solicitada",
};

export default async function NewSalePage() {
  // Gate por permissão: quem não pode vender (ex.: gerente) vai para a primeira
  // página que pode usar, em vez de estourar 403 nas chamadas abaixo.
  const principal = await requireSession();
  if (!principal.permissions.includes("pix.charge.create")) redirect(landingPathFor(principal.permissions));
  const [activity, cash, readiness, effective] = await Promise.all([
    apiFetch<{ data: ActivityItem[] }>("/activity/recent"),
    apiFetch<{ data: CashSessionDto | null }>("/cash-sessions/current"),
    apiFetch<{ data: { configured: boolean; status: string; providerMode: "real" | "mock"; lastVerifiedAt: string | null } }>("/pix/readiness"),
    // Automações configuradas (impressão automática, retorno pós-pagamento).
    apiFetch<{ data: { autoPrint: boolean; printAfterConfirmation: boolean; autoReturnToSale: boolean; autoReturnSeconds: number } }>("/settings/effective"),
  ]);
  const currentCash = cash.data;
  const automation = {
    autoPrint: effective.data.autoPrint,
    printAfterConfirmation: effective.data.printAfterConfirmation,
    autoReturnToSale: effective.data.autoReturnToSale,
    autoReturnSeconds: effective.data.autoReturnSeconds,
  };

  return (
    <div className="page-container">
      <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="display-title">Nova venda</h1>
          <p className="mt-2 text-[var(--ink-muted)]">Informe o código e o valor para gerar uma cobrança Pix.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-semibold text-[var(--success)]">
          <Radio size={17} /> {readiness.data.configured ? "Mercado Pago pronto" : "Integração pendente"}
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card overflow-hidden" aria-labelledby="sale-form-title">
          <div className="grid md:grid-cols-[128px_minmax(0,1fr)]">
            <div className="border-b border-[var(--border)] bg-[var(--surface-subtle)] px-6 py-7 md:border-b-0 md:border-r">
              <ol className="relative flex justify-between md:block" aria-label="Etapas da operação">
                {[
                  ["01", "Código", true],
                  ["02", "Valor", false],
                  ["03", "Pix", false],
                  ["04", "Pago", false],
                ].map(([number, label, active], index) => (
                  <li key={String(number)} className="relative z-10 flex flex-col items-center gap-2 md:mb-9 md:flex-row">
                    <span className={`grid h-8 w-8 place-items-center rounded-full border text-[0.7rem] font-bold ${active ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink-faint)]"}`}>{number}</span>
                    <span className={`text-xs font-bold ${active ? "text-[var(--primary-strong)]" : "text-[var(--ink-faint)]"}`}>{label}</span>
                    {index < 3 && <span className="absolute left-[calc(50%+16px)] top-4 -z-10 h-px w-[calc(100%-32px)] bg-[var(--border)] md:left-4 md:top-8 md:h-10 md:w-px" aria-hidden="true" />}
                  </li>
                ))}
              </ol>
            </div>
            <div className="px-6 py-7 sm:px-9 sm:py-9">
              <div className="mb-8">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--primary)]">Cobrança Pix</p>
                <h2 id="sale-form-title" className="mt-2 font-[var(--font-display)] text-2xl font-semibold tracking-[-0.03em]">Dados essenciais</h2>
              </div>
              <NewSaleForm currentCash={currentCash} readiness={readiness.data} automation={automation} />
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="card p-5" aria-labelledby="cash-state-title">
            <div className="flex items-start gap-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${currentCash ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>
                {currentCash ? <CheckCircle2 size={19} /> : <LockKeyhole size={19} />}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 id="cash-state-title" className="font-[var(--font-display)] text-lg font-semibold">{currentCash ? currentCash.cashRegister.name : "Caixa fechado"}</h2>
                  {currentCash && <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[0.7rem] font-bold text-[var(--success)]">Aberto</span>}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-[var(--ink-muted)]">
                  {currentCash ? `${currentCash.cashRegister.code} · aberto por ${currentCash.operator.name}` : "Abra o caixa antes de gerar uma cobrança."}
                </p>
                {!currentCash && <Link href="/caixa" className="mt-3 inline-flex text-sm font-bold text-[var(--primary)] hover:text-[var(--primary-strong)]">Abrir caixa →</Link>}
              </div>
            </div>
          </section>

          <section className="card p-5" aria-labelledby="activity-title">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="activity-title" className="font-[var(--font-display)] text-lg font-semibold">Atividade recente</h2>
              <Activity size={18} className="text-[var(--ink-faint)]" />
            </div>
            {activity.data.length === 0 ? (
              <p className="rounded-xl bg-[var(--surface-muted)] px-4 py-5 text-sm text-[var(--ink-muted)]">Nenhuma atividade registrada.</p>
            ) : (
              <ul className="space-y-1">
                {activity.data.map((item) => (
                  <li key={item.publicId} className="flex gap-3 border-b border-[var(--border)] py-3 last:border-0">
                    <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.outcome === "SUCCESS" ? "bg-[var(--success)]" : "bg-[var(--danger)]"}`} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{activityLabels[item.action] ?? item.action}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-faint)]"><Clock3 size={13} /> {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(item.createdAt))}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
