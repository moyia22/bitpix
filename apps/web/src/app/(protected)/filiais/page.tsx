import { redirect } from "next/navigation";
import { BranchManager } from "@/features/admin/branch-manager";
import { apiFetch, requireSession } from "@/lib/server-api";
type Branch = Parameters<typeof BranchManager>[0]["branches"][number];
export default async function BranchesPage() {
  const principal = await requireSession();
  if (!principal.permissions.includes("branches.read") && !principal.permissions.includes("branches.manage")) redirect("/nova-venda");
  const branches = (await apiFetch<{ data: Branch[] }>("/branches?pageSize=50")).data;
  return <div className="page-container management-page"><div className="management-heading"><div><p className="eyebrow">Administração</p><h1 className="display-title">Filiais</h1><p>Unidades isoladas dentro de {principal.company.displayName}.</p></div></div><BranchManager branches={branches} canCreate={principal.permissions.includes("branches.create") || principal.permissions.includes("branches.manage")} canUpdate={principal.permissions.includes("branches.update") || principal.permissions.includes("branches.disable") || principal.permissions.includes("branches.manage")} /></div>;
}
