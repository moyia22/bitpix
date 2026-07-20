import type {
  CashMovementDto,
  CashRegisterDto,
  CashSessionDto,
  PaginatedDto,
} from "@bitpix/contracts";
import type { Metadata } from "next";
import { ShieldCheck, WalletCards } from "lucide-react";
import { CashConsole } from "@/features/cash/cash-console";
import { apiFetch, requireSession } from "@/lib/server-api";

export const metadata: Metadata = { title: "Caixa" };

interface BranchOption {
  publicId: string;
  code: string;
  name: string;
  active: boolean;
}

const emptyMovements: PaginatedDto<CashMovementDto> = {
  data: [],
  pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
};

export default async function CashPage() {
  const principal = await requireSession();
  const [{ data: registers }, { data: currentSession }, { data: branches }] = await Promise.all([
    apiFetch<{ data: CashRegisterDto[] }>("/cash-registers"),
    apiFetch<{ data: CashSessionDto | null }>("/cash-sessions/current"),
    apiFetch<{ data: BranchOption[] }>("/branches"),
  ]);
  const movements = currentSession && principal.permissions.includes("cash.movement.read")
    ? await apiFetch<PaginatedDto<CashMovementDto>>(`/cash-sessions/${currentSession.publicId}/movements?page=1&pageSize=10`)
    : emptyMovements;

  return (
    <div className="page-container">
      <div className="cash-page-heading">
        <div>
          <span className="dev-badge mb-4"><span className="status-dot" /> Desenvolvimento</span>
          <h1 className="display-title">Controle de caixa</h1>
          <p>Abra, movimente e feche o turno com valores calculados no servidor.</p>
        </div>
        <div className="cash-security-note">
          <span><ShieldCheck size={19} /></span>
          <div><strong>Operação rastreável</strong><small>Transações e auditoria em cada etapa</small></div>
          <WalletCards size={21} />
        </div>
      </div>
      <CashConsole
        initialRegisters={registers}
        initialSession={currentSession}
        initialMovements={movements}
        branches={branches}
        permissions={principal.permissions}
      />
    </div>
  );
}

