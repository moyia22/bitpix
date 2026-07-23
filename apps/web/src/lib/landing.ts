// Primeira página que o usuário PODE usar, na ordem de prioridade do balcão.
// Evita mandar gerentes/perfis sem permissão de venda para /nova-venda (403).
const LANDING_ORDER: Array<{ path: string; permission: string }> = [
  { path: "/nova-venda", permission: "pix.charge.create" },
  { path: "/caixa", permission: "cash.session.read" },
  { path: "/dashboard", permission: "dashboard.read" },
  { path: "/historico", permission: "pix.charge.read" },
  { path: "/relatorios", permission: "reports.sales.read" },
  { path: "/plataforma", permission: "platform.dashboard.read" },
  { path: "/notificacoes", permission: "notifications.read" },
];

export function landingPathFor(permissions: readonly string[]): string {
  const set = new Set(permissions);
  for (const item of LANDING_ORDER) if (set.has(item.permission)) return item.path;
  // Configurações renderiza para qualquer autenticado (conteúdo interno é gateado).
  return "/configuracoes";
}
