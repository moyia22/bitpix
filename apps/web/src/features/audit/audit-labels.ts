// Rótulos amigáveis em português para as ações auditadas. Fallback humaniza o
// código (pontos viram " › ") para nunca ficar em branco.
const ACTION_LABELS: Record<string, string> = {
  "auth.login.succeeded": "Login realizado",
  "auth.login.failed": "Tentativa de login recusada",
  "auth.logout": "Sessão encerrada",
  "auth.mfa.setup.started": "Início da configuração do 2FA",
  "auth.mfa.enabled": "2FA ativado",
  "auth.mfa.disabled": "2FA desativado",
  "auth.mfa.failed": "Código 2FA inválido",
  "auth.password.changed": "Senha alterada",
  "auth.password_reset.requested": "Redefinição de senha solicitada",
  "auth.password_reset.completed": "Senha redefinida",
  "auth.sessions.revoked": "Outras sessões revogadas",
  "authorization.denied": "Acesso negado (sem permissão)",
  "tenant.access.denied": "Acesso negado (outra empresa)",
  "branch.created": "Filial criada",
  "branch.updated": "Filial atualizada",
  "branch.enabled": "Filial reativada",
  "branch.disabled": "Filial desativada",
  "cash.register.created": "Caixa cadastrado",
  "cash.register.updated": "Caixa atualizado",
  "cash.register.disabled": "Caixa desativado",
  "cash.session.opened": "Caixa aberto",
  "cash.session.opened.override": "Caixa aberto (override admin)",
  "cash.session.open.denied.not_owner": "Abertura negada (não é o dono)",
  "cash.session.closed": "Caixa fechado",
  "cash.session.closed_with_pending_override": "Caixa fechado com pendências (exceção)",
  "cash.session.close_blocked.pending_charges": "Fechamento bloqueado (Pix pendente)",
  "cash.movement.denied.closed": "Movimento negado (caixa fechado)",
  "integration.mercado_pago.connection_tested": "Mercado Pago testado",
  "integration.mercado_pago.connection_failed": "Falha ao testar o Mercado Pago",
  "integration.mercado_pago.credential_removed": "Credencial do Mercado Pago removida",
  "pix.charge.creation_requested": "Cobrança Pix solicitada",
  "pix.charge.created": "Cobrança Pix criada",
  "pix.charge.creation_failed": "Falha ao criar cobrança Pix",
  "pix.charge.cancelled": "Cobrança Pix cancelada",
  "pix.charge.code_copied": "Código Pix copiado",
  "pix.charge.reconciled": "Cobrança reconciliada",
  "pix.charge.reconciliation_failed": "Falha na reconciliação",
  "pix.charge.duplicate_blocked": "Cobrança duplicada bloqueada",
  "pix.charge.denied.cash_closed": "Cobrança negada (caixa fechado)",
  "pix.charge.denied.provider_not_ready": "Cobrança negada (Mercado Pago não pronto)",
  "pix.charge.denied.payer_email": "Cobrança negada (e-mail do pagador inválido)",
  "pix.charge.read_denied": "Consulta de cobrança negada",
  "pix.payment.confirmed": "Pagamento confirmado",
  "pix.payment.value_mismatch": "Valor recebido divergente",
  "pix.payment.validation_failed": "Validação do pagamento falhou",
  "pix.payment.receipt_printed": "Comprovante impresso",
  "pix.refund.request_created": "Estorno solicitado",
  "pix.refund.requested": "Estorno registrado",
  "pix.refund.approved": "Estorno aprovado",
  "pix.refund.denied": "Estorno negado",
  "pix.refund.confirmed": "Estorno confirmado",
  "pix.webhook.received": "Webhook recebido",
  "pix.webhook.queued": "Webhook enfileirado",
  "pix.webhook.processing_started": "Processamento do webhook iniciado",
  "pix.webhook.processing_completed": "Webhook processado",
  "pix.webhook.duplicate": "Webhook duplicado",
  "pix.webhook.reprocessed": "Webhook reprocessado",
  "pix.webhook.signature_invalid": "Webhook com assinatura inválida",
  "report.export.requested": "Exportação solicitada",
  "report.export.downloaded": "Exportação baixada",
  "role.created": "Função criada",
  "role.updated": "Função atualizada",
  "role.disabled": "Função desativada",
  "settings.updated": "Configurações atualizadas",
  "print.template.updated": "Modelo de impressão atualizado",
  "print.logo.updated": "Logo de impressão atualizada",
  "platform.company.created": "Empresa criada",
  "platform.plan.created": "Plano criado",
  "sale.prepare.denied.cash_closed": "Venda negada (caixa fechado)",
  "user.created": "Usuário criado",
  "user.updated": "Usuário atualizado",
  "user.deactivated": "Usuário desativado",
  "user.deleted": "Usuário excluído",
  "user.password.set": "Senha definida pelo admin",
  "user.mfa.reset": "2FA do usuário zerado",
  "user.sessions.revoked": "Sessões do usuário revogadas",
};

export function describeAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll(".", " › ");
}

// Agrupa por área para ícone/cor.
export function actionGroup(action: string): "auth" | "pix" | "cash" | "refund" | "user" | "config" | "other" {
  if (action.startsWith("pix.refund")) return "refund";
  if (action.startsWith("pix.")) return "pix";
  if (action.startsWith("auth.") || action.includes("authorization") || action.includes("tenant.access")) return "auth";
  if (action.startsWith("cash.")) return "cash";
  if (action.startsWith("user.") || action.startsWith("role.") || action.startsWith("branch.")) return "user";
  if (action.startsWith("settings") || action.startsWith("print") || action.startsWith("integration") || action.startsWith("report")) return "config";
  return "other";
}
