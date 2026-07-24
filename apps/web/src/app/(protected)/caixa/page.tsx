import type {
  CashMovementDto,
  CashRegisterDto,
  CashSessionDto,
  PaginatedDto,
} from "@bitpix/contracts";
import type { Metadata } from "next";
import { ShieldCheck, WalletCards } from "lucide-react";
import { redirect } from "next/navigation";
import { CashConsole } from "@/features/cash/cash-console";
import { landingPathFor } from "@/lib/landing";
import { apiFetch, requireSession } from "@/lib/server-api";

export const metadata: Metadata = { title: "Caixa" };

interface BranchOption {
  publicId: string;
  code: string;
  name: string;
  active: boolean;
}

interface UserOption {
  publicId: string;
  name: string;
}

const emptyMovements: PaginatedDto<CashMovementDto> = {
  data: [],
  pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
};

export default async function CashPage() {
  const principal = await requireSession();
  // Gate: sem permissão de caixa, segue para a primeira página utilizável (evita 403).
  if (!principal.permissions.includes("cash.session.read")) redirect(landingPathFor(principal.permissions));
  const [{ data: registers }, { data: currentSession }, { data: branches }] = await Promise.all([
    apiFetch<{ data: CashRegisterDto[] }>("/cash-registers"),
    apiFetch<{ data: CashSessionDto | null }>("/cash-sessions/current"),
    apiFetch<{ data: BranchOption[] }>("/branches"),
  ]);
  const movements = currentSession && principal.permissions.includes("cash.movement.read")
    ? await apiFetch<PaginatedDto<CashMovementDto>>(`/cash-sessions/${currentSession.publicId}/movements?page=1&pageSize=10`)
    : emptyMovements;

  // Seletor de dono é um recurso secundário: seu carregamento NUNCA pode derrubar
  // a página de caixa. pageSize respeita o máximo do contrato (50); qualquer falha
  // degrada para lista vazia em vez de estourar a fronteira de erro.
  const canPickOwner = principal.permissions.includes("users.read") || principal.permissions.includes("users.manage");
  const owners = canPickOwner
    ? await apiFetch<PaginatedDto<UserOption>>("/users?pageSize=50")
        .then((res) => res.data.map((u) => ({ publicId: u.publicId, name: u.name })))
        .catch(() => [] as UserOption[])
    : [];

  // Gestão admin: todas as sessões de caixa ABERTAS (visão da equipe para o
  // fechamento). Quem só consulta o próprio caixa não vê este bloco.
  const canManageTeam = principal.permissions.includes("cash.reports.read") || principal.permissions.includes("users.read");
  const teamSessions = canManageTeam
    ? (await apiFetch<PaginatedDto<CashSessionDto>>("/cash-sessions?status=OPEN&pageSize=50")).data
    : [];
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="page-container">
      <div className="cash-page-heading">
        <div>
          <h1 className="display-title">Controle de caixa</h1>
          <p>Abra, movimente e feche o turno com valores calculados no servidor.</p>
        </div>
        <div className="cash-security-note">
          <span><ShieldCheck size={19} /></span>
          <div><strong>Operação rastreável</strong><small>Transações e auditoria em cada etapa</small></div>
          <WalletCards size={21} />
        </div>
      </div>
      {teamSessions.length > 0 && (
        <section className="card team-cash" aria-label="Caixas abertos da equipe">
          <div className="team-cash-head">
            <div><p className="cash-kicker">Gestão · Equipe</p><h2>Caixas abertos da equipe</h2></div>
            <span className="team-cash-total">Pix recebido hoje <strong>{brl.format(teamSessions.reduce((sum, s) => sum + Number(s.totals.confirmedPix), 0))}</strong></span>
          </div>
          <div className="team-cash-grid">
            {teamSessions.map((session) => (
              <article key={session.publicId} className="team-cash-card">
                <div className="team-cash-op"><span className="team-cash-avatar">{session.operator.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}</span><div><strong>{session.operator.name}</strong><small>{session.cashRegister.name} · {session.cashRegister.code}</small></div></div>
                <dl className="team-cash-stats">
                  <div><dt>Pix confirmado</dt><dd>{brl.format(Number(session.totals.confirmedPix))}</dd></div>
                  <div><dt>Saldo esperado</dt><dd>{brl.format(Number(session.totals.expectedBalance))}</dd></div>
                  <div><dt>Operações</dt><dd>{session.totals.operationCount}</dd></div>
                  <div><dt>Aberto desde</dt><dd>{new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(new Date(session.openedAt))}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}
      <CashConsole
        initialRegisters={registers}
        initialSession={currentSession}
        initialMovements={movements}
        branches={branches}
        owners={owners}
        currentUserPublicId={principal.user.publicId}
        permissions={principal.permissions}
      />
    </div>
  );
}

