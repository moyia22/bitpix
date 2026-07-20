import { redirect } from "next/navigation";
import { UserManager } from "@/features/admin/user-manager";
import { apiFetch, requireSession } from "@/lib/server-api";
type Props = Parameters<typeof UserManager>[0];
export default async function UsersPage() {
  const principal = await requireSession();
  if (!principal.permissions.includes("users.read") && !principal.permissions.includes("users.manage")) redirect("/nova-venda");
  const [users, roles, branches] = await Promise.all([
    apiFetch<{ data: Props["users"] }>("/users?pageSize=50"),
    apiFetch<{ data: Array<Props["roles"][number] & { active: boolean }> }>("/roles"),
    apiFetch<{ data: Array<Props["branches"][number] & { active: boolean }> }>("/branches?pageSize=50"),
  ]);
  return <div className="page-container management-page"><div className="management-heading"><div><p className="eyebrow">Administração</p><h1 className="display-title">Usuários</h1><p>Contas, funções, filiais e sessões revogáveis da empresa.</p></div></div><UserManager users={users.data} roles={roles.data.filter((role) => role.active)} branches={branches.data.filter((branch) => branch.active)} canCreate={principal.permissions.includes("users.create") || principal.permissions.includes("users.manage")} canUpdate={principal.permissions.includes("users.update") || principal.permissions.includes("users.disable") || principal.permissions.includes("users.manage")} canRevoke={principal.permissions.includes("users.sessions.revoke") || principal.permissions.includes("users.manage")} /></div>;
}
