import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuditConsole } from "@/features/audit/audit-console";
import { apiFetch, requireSession } from "@/lib/server-api";

export const metadata: Metadata = { title: "Auditoria" };

interface AuditItem { publicId: string; action: string; entity: string; entityPublicId: string | null; outcome: "SUCCESS" | "FAILURE"; correlationId: string | null; ipAddress: string | null; createdAt: string; actor: { name: string } | null; branch: { name: string } | null }
interface Pagination { page: number; pageSize: number; total: number; totalPages: number }

export default async function AuditPage() {
  const principal = await requireSession();
  if (!principal.permissions.includes("audit.read")) redirect("/nova-venda");
  const initial = await apiFetch<{ data: AuditItem[]; pagination: Pagination }>("/audit?page=1&pageSize=20");

  return (
    <div className="page-container management-page">
      <div className="management-heading">
        <div>
          <p className="eyebrow">Segurança</p>
          <h1 className="display-title">Auditoria</h1>
          <p>Registro imutável de tudo que acontece na empresa — quem fez, o quê, quando e de onde. Clique num evento para ver os detalhes e o que mudou.</p>
        </div>
      </div>
      <AuditConsole initial={initial.data} pagination={initial.pagination} canReadDetails={principal.permissions.includes("audit.details.read")} />
    </div>
  );
}
