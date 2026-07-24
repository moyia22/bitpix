"use client";

import type {
  CashMovementDto,
  CashRegisterDto,
  CashSessionDto,
  PaginatedDto,
  PermissionKey,
} from "@bitpix/contracts";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  LockKeyhole,
  Plus,
  Power,
  ReceiptText,
  Store,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

interface BranchOption {
  publicId: string;
  code: string;
  name: string;
  active: boolean;
}

interface CashConsoleProps {
  initialRegisters: CashRegisterDto[];
  initialSession: CashSessionDto | null;
  initialMovements: PaginatedDto<CashMovementDto>;
  branches: BranchOption[];
  owners: { publicId: string; name: string }[];
  currentUserPublicId: string;
  permissions: PermissionKey[];
}

type ActionPanel = "supply" | "withdrawal" | "close" | "register" | null;

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const movementLabels: Record<CashMovementDto["type"], string> = {
  OPENING_BALANCE: "Saldo inicial",
  SUPPLY: "Suprimento",
  WITHDRAWAL: "Sangria",
  PIX_PAYMENT: "Pagamento Pix",
  PIX_REFUND: "Devolução Pix",
  ADJUSTMENT: "Ajuste",
  CLOSING_ADJUSTMENT: "Ajuste de fechamento",
};

function formatMoney(value: string | number): string {
  return brl.format(Number(value));
}

function centsFromInput(value: string): number {
  return Number(value.replace(/\D/g, "").slice(0, 11) || 0);
}

function moneyInput(cents: number): string {
  return brl.format(cents / 100);
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message ?? "Não foi possível concluir a operação.");
  return body as T;
}

function elapsedTime(openedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours > 0 ? `${hours}h ${remaining.toString().padStart(2, "0")}min` : `${remaining} min`;
}

export function CashConsole({
  initialRegisters,
  currentUserPublicId,
  initialSession,
  initialMovements,
  branches,
  owners,
  permissions,
}: CashConsoleProps) {
  const router = useRouter();
  const permissionSet = useMemo(() => new Set(permissions), [permissions]);
  const [registers, setRegisters] = useState(initialRegisters);
  const [session, setSession] = useState(initialSession);
  const [movements, setMovements] = useState(initialMovements);
  const [panel, setPanel] = useState<ActionPanel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [openingCents, setOpeningCents] = useState(0);
  const [selectedRegister, setSelectedRegister] = useState(
    initialRegisters.find((register) => register.status === "ACTIVE" && register.owner?.publicId === currentUserPublicId)?.publicId
      ?? initialRegisters.find((register) => register.status === "ACTIVE")?.publicId
      ?? "",
  );
  const [openingNote, setOpeningNote] = useState("");
  const [movementCents, setMovementCents] = useState(0);
  const [movementReason, setMovementReason] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [withdrawalReview, setWithdrawalReview] = useState(false);
  const [countedCents, setCountedCents] = useState(0);
  const [closingNote, setClosingNote] = useState("");
  const [closingConfirmed, setClosingConfirmed] = useState(false);
  const [allowPendingCharges, setAllowPendingCharges] = useState(false);
  const [registerName, setRegisterName] = useState("");
  const [registerCode, setRegisterCode] = useState("");
  const [registerDescription, setRegisterDescription] = useState("");
  const [registerBranch, setRegisterBranch] = useState(branches.find((branch) => branch.active)?.publicId ?? "");
  const [registerOwner, setRegisterOwner] = useState(owners[0]?.publicId ?? "");

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [session]);

  const resetNotices = () => { setError(""); setSuccess(""); };

  const refreshMovements = async (sessionPublicId: string, page = 1) => {
    const result = await apiRequest<PaginatedDto<CashMovementDto>>(
      `/cash-sessions/${sessionPublicId}/movements?page=${page}&pageSize=10`,
    );
    setMovements(result);
  };

  const openCash = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetNotices();
    setBusy(true);
    try {
      const result = await apiRequest<{ data: CashSessionDto }>("/cash-sessions/open", {
        method: "POST",
        body: JSON.stringify({
          cashRegisterPublicId: selectedRegister,
          openingBalanceInCents: openingCents,
          note: openingNote || null,
        }),
      });
      setSession(result.data);
      setSuccess(`${result.data.cashRegister.name} aberto com segurança.`);
      setPanel(null);
      await refreshMovements(result.data.publicId);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir o caixa.");
    } finally {
      setBusy(false);
    }
  };

  const executeMovement = async (kind: "supply" | "withdrawal") => {
    if (!session) return;
    resetNotices();
    setBusy(true);
    try {
      const endpoint = kind === "supply" ? "supplies" : "withdrawals";
      const result = await apiRequest<{ data: { session: CashSessionDto } }>(
        `/cash-sessions/${session.publicId}/${endpoint}`,
        {
          method: "POST",
          body: JSON.stringify({
            amountInCents: movementCents,
            reason: movementReason,
            note: movementNote || null,
          }),
        },
      );
      setSession(result.data.session);
      setSuccess(kind === "supply" ? "Suprimento registrado." : "Sangria registrada.");
      setMovementCents(0);
      setMovementReason("");
      setMovementNote("");
      setWithdrawalReview(false);
      setPanel(null);
      await refreshMovements(session.publicId);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível registrar a movimentação.");
    } finally {
      setBusy(false);
    }
  };

  const submitMovement = (event: FormEvent<HTMLFormElement>, kind: "supply" | "withdrawal") => {
    event.preventDefault();
    if (kind === "withdrawal" && !withdrawalReview) {
      setWithdrawalReview(true);
      return;
    }
    void executeMovement(kind);
  };

  const closeCash = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || !closingConfirmed) return;
    resetNotices();
    setBusy(true);
    try {
      const result = await apiRequest<{ data: CashSessionDto }>(`/cash-sessions/${session.publicId}/close`, {
        method: "POST",
        body: JSON.stringify({
          countedBalanceInCents: countedCents,
          note: closingNote || null,
          confirmed: true,
          allowPendingCharges,
        }),
      });
      setSession(null);
      setMovements({ data: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
      setPanel(null);
      setSuccess(`Caixa fechado. Divergência registrada: ${formatMoney(result.data.discrepancy ?? "0")}.`);
      setClosingConfirmed(false);
      setAllowPendingCharges(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível fechar o caixa.");
    } finally {
      setBusy(false);
    }
  };

  const createRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetNotices();
    setBusy(true);
    try {
      const result = await apiRequest<{ data: CashRegisterDto }>("/cash-registers", {
        method: "POST",
        body: JSON.stringify({
          branchPublicId: registerBranch,
          name: registerName,
          code: registerCode,
          description: registerDescription || null,
          ownerUserPublicId: registerOwner,
        }),
      });
      setRegisters((current) => [...current, result.data].sort((a, b) => a.code.localeCompare(b.code)));
      setSelectedRegister(result.data.publicId);
      setRegisterName("");
      setRegisterCode("");
      setRegisterDescription("");
      setPanel(null);
      setSuccess("Caixa cadastrado e disponível para abertura.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível cadastrar o caixa.");
    } finally {
      setBusy(false);
    }
  };

  const disableRegister = async (register: CashRegisterDto) => {
    resetNotices();
    setBusy(true);
    try {
      const result = await apiRequest<{ data: CashRegisterDto }>(`/cash-registers/${register.publicId}/disable`, { method: "POST" });
      setRegisters((current) => current.map((item) => item.publicId === result.data.publicId ? result.data : item));
      if (selectedRegister === result.data.publicId) {
        setSelectedRegister(registers.find((item) => item.publicId !== result.data.publicId && item.status === "ACTIVE")?.publicId ?? "");
      }
      setSuccess(`${register.name} foi desativado sem excluir seu histórico.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível desativar o caixa.");
    } finally {
      setBusy(false);
    }
  };

  const expectedCents = session ? Math.round(Number(session.totals.expectedBalance) * 100) : 0;
  const discrepancyCents = countedCents - expectedCents;
  const activeRegisters = registers.filter((register) => register.status === "ACTIVE");
  // Isolamento por usuário: quem NÃO tem o override (cash.session.open.any) só vê/abre o
  // próprio caixa; quem tem (admin) enxerga e opera todos.
  const seesAllRegisters = permissionSet.has("cash.session.open.any");
  const openableRegisters = seesAllRegisters
    ? activeRegisters
    : activeRegisters.filter((register) => register.owner?.publicId === currentUserPublicId);
  const visibleRegisters = seesAllRegisters
    ? registers
    : registers.filter((register) => register.owner?.publicId === currentUserPublicId);
  const metricItems: Array<{ label: string; value: string; Icon: LucideIcon }> = session ? [
    { label: "Saldo inicial", value: session.totals.openingBalance, Icon: WalletCards },
    { label: "Suprimentos", value: session.totals.supplies, Icon: ArrowDownToLine },
    { label: "Sangrias", value: session.totals.withdrawals, Icon: ArrowUpFromLine },
    { label: "Pix confirmado", value: session.totals.confirmedPix, Icon: CheckCircle2 },
  ] : [];

  return (
    <div className="space-y-6">
      {(error || success) && (
        <div role={error ? "alert" : "status"} className={`cash-notice ${error ? "cash-notice-error" : "cash-notice-success"}`}>
          {error || success}
          <button type="button" aria-label="Fechar aviso" onClick={resetNotices}><X size={17} /></button>
        </div>
      )}

      {!session ? (
        <section className="cash-closed-layout" aria-labelledby="cash-closed-title">
          <div className="cash-state-rail">
            <span className="cash-state-icon"><LockKeyhole size={24} /></span>
            <div>
              <p className="cash-kicker">Estado operacional</p>
              <h2 id="cash-closed-title">Caixa fechado</h2>
              <p>Nenhuma operação financeira pode ser iniciada até a abertura.</p>
            </div>
          </div>
          <form className="cash-open-form" onSubmit={openCash}>
            <div className="cash-form-heading">
              <div>
                <p className="cash-kicker">Início do turno</p>
                <h3>Abrir caixa</h3>
              </div>
              <span>Todos os valores serão auditados</span>
            </div>
            <label className="field-label" htmlFor="cash-register">Caixa ou terminal</label>
            <select className="field-input" id="cash-register" value={selectedRegister} onChange={(event) => setSelectedRegister(event.target.value)} required>
              <option value="">Selecione um caixa</option>
              {openableRegisters.map((register) => <option value={register.publicId} key={register.publicId}>{register.code} · {register.name}</option>)}
            </select>
            <div className="cash-form-grid">
              <div>
                <label className="field-label" htmlFor="opening-balance">Saldo inicial</label>
                <input className="field-input cash-money-input" id="opening-balance" inputMode="numeric" value={moneyInput(openingCents)} onChange={(event) => setOpeningCents(centsFromInput(event.target.value))} />
              </div>
              <div>
                <label className="field-label" htmlFor="opening-note">Observação opcional</label>
                <input className="field-input" id="opening-note" maxLength={500} value={openingNote} onChange={(event) => setOpeningNote(event.target.value)} placeholder="Ex.: início do turno da manhã" />
              </div>
            </div>
            <button className="primary-button" type="submit" disabled={busy || !selectedRegister || !permissionSet.has("cash.session.open")}>
              <Power size={18} /> {busy ? "Abrindo…" : "Abrir caixa"}
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="cash-open-hero" aria-labelledby="cash-current-title">
            <div className="cash-open-primary">
              <div className="cash-open-status"><span className="status-dot" /> Aberto</div>
              <p className="cash-kicker">Caixa atual</p>
              <h2 id="cash-current-title">{session.cashRegister.name}</h2>
              <p>{session.cashRegister.code} · {session.branch.name}</p>
              <dl className="cash-open-meta">
                <div><dt>Operador</dt><dd>{session.operator.name}</dd></div>
                <div><dt>Aberto em</dt><dd>{dateTime.format(new Date(session.openedAt))}</dd></div>
                <div><dt>Tempo aberto</dt><dd>{elapsedTime(session.openedAt, now)}</dd></div>
              </dl>
            </div>
            <div className="cash-expected-balance">
              <span>Saldo esperado</span>
              <strong>{formatMoney(session.totals.expectedBalance)}</strong>
              <small>{session.totals.operationCount} movimentações registradas</small>
            </div>
          </section>

          <section className="cash-metrics" aria-label="Totais da sessão">
            {metricItems.map(({ label, value, Icon }) => (
              <article className="cash-metric" key={label}>
                <Icon size={18} />
                <span>{label}</span>
                <strong>{formatMoney(value)}</strong>
              </article>
            ))}
          </section>

          <section className="cash-actions-card" aria-label="Ações de caixa">
            <div>
              <p className="cash-kicker">Ações do turno</p>
              <h3>Movimentar com rastreabilidade</h3>
            </div>
            <div className="cash-action-buttons">
              {permissionSet.has("cash.movement.supply") && <button type="button" onClick={() => { setPanel("supply"); resetNotices(); }}><ArrowDownToLine size={18} /> Registrar suprimento</button>}
              {permissionSet.has("cash.movement.withdrawal") && <button type="button" onClick={() => { setPanel("withdrawal"); setWithdrawalReview(false); resetNotices(); }}><ArrowUpFromLine size={18} /> Registrar sangria</button>}
              {permissionSet.has("cash.session.close") && <button type="button" className="danger-action" onClick={() => { setPanel("close"); setCountedCents(expectedCents); resetNotices(); }}><Power size={18} /> Fechar caixa</button>}
            </div>
          </section>

          {(panel === "supply" || panel === "withdrawal") && (
            <form className="cash-inline-panel" onSubmit={(event) => submitMovement(event, panel)}>
              <div className="cash-panel-heading">
                <div><p className="cash-kicker">Movimentação manual</p><h3>{panel === "supply" ? "Registrar suprimento" : "Registrar sangria"}</h3></div>
                <button className="icon-button" type="button" onClick={() => setPanel(null)} aria-label="Fechar formulário"><X size={18} /></button>
              </div>
              <div className="cash-form-grid cash-form-grid-three">
                <div><label className="field-label" htmlFor="movement-value">Valor</label><input className="field-input cash-money-input" id="movement-value" inputMode="numeric" value={moneyInput(movementCents)} onChange={(event) => { setMovementCents(centsFromInput(event.target.value)); setWithdrawalReview(false); }} /></div>
                <div><label className="field-label" htmlFor="movement-reason">Motivo</label><input className="field-input" id="movement-reason" minLength={3} maxLength={160} required value={movementReason} onChange={(event) => { setMovementReason(event.target.value); setWithdrawalReview(false); }} placeholder="Motivo obrigatório" /></div>
                <div><label className="field-label" htmlFor="movement-note">Observação</label><input className="field-input" id="movement-note" maxLength={500} value={movementNote} onChange={(event) => setMovementNote(event.target.value)} placeholder="Opcional" /></div>
              </div>
              {panel === "withdrawal" && withdrawalReview && <div className="cash-confirmation"><strong>Confirme a sangria de {moneyInput(movementCents)}.</strong><span>Esta movimentação não poderá ser alterada silenciosamente.</span></div>}
              <button className="primary-button" type="submit" disabled={busy || movementCents <= 0 || movementReason.trim().length < 3}>{busy ? "Registrando…" : panel === "withdrawal" && !withdrawalReview ? "Revisar sangria" : panel === "withdrawal" ? "Confirmar sangria" : "Registrar suprimento"}</button>
            </form>
          )}

          {panel === "close" && (
            <form className="cash-inline-panel" onSubmit={closeCash}>
              <div className="cash-panel-heading">
                <div><p className="cash-kicker">Conferência final</p><h3>Fechar caixa</h3></div>
                <button className="icon-button" type="button" onClick={() => setPanel(null)} aria-label="Fechar formulário"><X size={18} /></button>
              </div>
              <div className="cash-closing-summary">
                <span>Inicial <strong>{formatMoney(session.totals.openingBalance)}</strong></span>
                <span>Suprimentos <strong>{formatMoney(session.totals.supplies)}</strong></span>
                <span>Sangrias <strong>- {formatMoney(session.totals.withdrawals)}</strong></span>
                <span>Pix confirmado <strong>{formatMoney(session.totals.confirmedPix)}</strong></span>
                <span>Ajustes <strong>{formatMoney(session.totals.adjustments)}</strong></span>
                <span>Saldo esperado <strong>{formatMoney(session.totals.expectedBalance)}</strong></span>
              </div>
              <div className="cash-form-grid">
                <div><label className="field-label" htmlFor="counted-balance">Valor contado</label><input className="field-input cash-money-input" id="counted-balance" inputMode="numeric" value={moneyInput(countedCents)} onChange={(event) => { setCountedCents(centsFromInput(event.target.value)); setClosingConfirmed(false); }} /></div>
                <div><label className="field-label" htmlFor="closing-note">Observação</label><input className="field-input" id="closing-note" maxLength={500} value={closingNote} onChange={(event) => setClosingNote(event.target.value)} placeholder="Opcional" /></div>
              </div>
              <div className={`cash-discrepancy ${discrepancyCents === 0 ? "cash-discrepancy-zero" : ""}`}><span>Divergência</span><strong>{moneyInput(discrepancyCents)}</strong></div>
              {session.pendingChargeCount > 0 && <div className="cash-notice cash-notice-error"><span><strong>{session.pendingChargeCount} cobrança(s) Pix pendente(s).</strong><br />O fechamento é bloqueado por padrão até a liquidação, expiração ou cancelamento.</span></div>}
              {session.pendingChargeCount > 0 && permissionSet.has("cash.session.close.with_pending_charges") && <label className="cash-final-confirm"><input type="checkbox" checked={allowPendingCharges} onChange={(event) => setAllowPendingCharges(event.target.checked)} /> Autorizar excepcionalmente o fechamento com cobranças pendentes. Esta ação será auditada.</label>}
              <label className="cash-final-confirm"><input type="checkbox" checked={closingConfirmed} onChange={(event) => setClosingConfirmed(event.target.checked)} /> Conferi os valores e confirmo o fechamento definitivo desta sessão.</label>
              <button className="primary-button cash-close-button" type="submit" disabled={busy || !closingConfirmed || (session.pendingChargeCount > 0 && !allowPendingCharges)}>{busy ? "Fechando…" : "Confirmar fechamento"}</button>
            </form>
          )}

          <section className="card cash-movements" aria-labelledby="movements-title">
            <div className="cash-section-heading"><div><p className="cash-kicker">Livro do turno</p><h3 id="movements-title">Movimentações recentes</h3></div><ReceiptText size={21} /></div>
            {movements.data.length === 0 ? <p className="cash-empty">Nenhuma movimentação registrada.</p> : (
              <div className="cash-table-wrap"><table><thead><tr><th>Tipo</th><th>Data e hora</th><th>Operador</th><th>Origem</th><th className="cash-value-column">Valor</th></tr></thead><tbody>{movements.data.map((movement) => <tr key={movement.publicId}><td><strong>{movementLabels[movement.type]}</strong><small>{movement.reason}</small></td><td>{dateTime.format(new Date(movement.createdAt))}</td><td>{movement.operator.name}</td><td>{movement.sourceType === "MANUAL" ? "Manual" : movement.sourceType === "SYSTEM" ? "Sistema" : "Pagamento"}</td><td className={`cash-value-column ${movement.direction === "DEBIT" ? "cash-value-debit" : "cash-value-credit"}`}>{movement.direction === "DEBIT" ? "−" : "+"} {formatMoney(movement.amount)}</td></tr>)}</tbody></table></div>
            )}
            {movements.pagination.totalPages > 1 && <div className="cash-pagination"><button type="button" disabled={movements.pagination.page <= 1} onClick={() => session && void refreshMovements(session.publicId, movements.pagination.page - 1)}>Anterior</button><span>Página {movements.pagination.page} de {movements.pagination.totalPages}</span><button type="button" disabled={movements.pagination.page >= movements.pagination.totalPages} onClick={() => session && void refreshMovements(session.publicId, movements.pagination.page + 1)}>Próxima</button></div>}
          </section>
        </>
      )}

      <section className="card cash-registers" aria-labelledby="registers-title">
        <div className="cash-section-heading">
          <div><p className="cash-kicker">Estrutura física</p><h3 id="registers-title">Caixas e terminais</h3></div>
          {permissionSet.has("cash.register.create") && <button type="button" className="cash-secondary-button" onClick={() => setPanel(panel === "register" ? null : "register")}><Plus size={17} /> Novo caixa</button>}
        </div>
        {panel === "register" && (
          <form className="cash-register-form" onSubmit={createRegister}>
            <div><label className="field-label" htmlFor="register-name">Nome</label><input className="field-input" id="register-name" required minLength={2} maxLength={100} value={registerName} onChange={(event) => setRegisterName(event.target.value)} placeholder="Ex.: Terminal 02" /></div>
            <div><label className="field-label" htmlFor="register-code">Código</label><input className="field-input" id="register-code" required maxLength={30} value={registerCode} onChange={(event) => setRegisterCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} placeholder="CX-02" /></div>
            <div><label className="field-label" htmlFor="register-branch">Filial</label><select className="field-input" id="register-branch" required value={registerBranch} onChange={(event) => setRegisterBranch(event.target.value)}>{branches.filter((branch) => branch.active).map((branch) => <option value={branch.publicId} key={branch.publicId}>{branch.code} · {branch.name}</option>)}</select></div>
            <div><label className="field-label" htmlFor="register-description">Descrição</label><input className="field-input" id="register-description" maxLength={240} value={registerDescription} onChange={(event) => setRegisterDescription(event.target.value)} placeholder="Opcional" /></div>
            <div><label className="field-label" htmlFor="register-owner">Dono do caixa</label><select className="field-input" id="register-owner" required value={registerOwner} onChange={(event) => setRegisterOwner(event.target.value)}><option value="">Selecione o dono</option>{owners.map((owner) => <option value={owner.publicId} key={owner.publicId}>{owner.name}</option>)}</select></div>
            <button className="primary-button" type="submit" disabled={busy || !registerOwner}>Cadastrar caixa</button>
          </form>
        )}
        <div className="cash-register-list">
          {visibleRegisters.map((register) => <article key={register.publicId}><span className="cash-register-icon"><Store size={18} /></span><div><strong>{register.name}</strong><small>{register.code} · {register.branch.name}{register.owner ? ` · Dono: ${register.owner.name}` : " · Sem dono"}</small></div><span className={register.status === "ACTIVE" ? "cash-status-active" : "cash-status-inactive"}>{register.status === "ACTIVE" ? "Ativo" : "Inativo"}</span>{register.status === "ACTIVE" && permissionSet.has("cash.register.disable") && <button type="button" disabled={busy || session?.cashRegister.publicId === register.publicId} onClick={() => void disableRegister(register)}>Desativar</button>}</article>)}
        </div>
      </section>
    </div>
  );
}
