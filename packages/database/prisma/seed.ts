import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import argon2 from "argon2";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), "../../.env") });
const { AuditOutcome, prisma } = await import("../src/index.js");

const permissionCatalog = [
  ["sales.create", "Criar vendas", "Criar cobranças para vendas"],
  ["sales.read", "Consultar vendas", "Consultar vendas permitidas"],
  ["pix.charge.create", "Criar cobrança Pix", "Criar cobranças Pix vinculadas ao caixa"],
  ["pix.charge.read", "Consultar cobrança Pix", "Consultar cobranças Pix da empresa"],
  ["pix.charge.cancel", "Cancelar cobrança Pix", "Cancelar cobranças Pix ainda pendentes"],
  ["pix.charge.copy", "Copiar código Pix", "Copiar o código Pix com registro de auditoria"],
  ["pix.charge.print", "Imprimir cobrança Pix", "Imprimir e reimprimir comprovantes Pix"],
  ["pix.payment.read", "Consultar pagamentos Pix", "Consultar pagamentos Pix confirmados da empresa"],
  ["pix.charge.reconcile", "Reconciliar cobrança Pix", "Consultar o provedor e reconciliar uma cobrança"],
  ["pix.webhook.read", "Consultar webhooks Pix", "Consultar eventos sanitizados do Mercado Pago"],
  ["pix.webhook.reprocess", "Reprocessar webhook Pix", "Reprocessar eventos válidos de forma idempotente"],
  ["pix.refund.create", "Solicitar reembolso Pix", "Solicitar reembolso pelo provedor"],
  ["pix.refund.read", "Consultar reembolsos Pix", "Consultar reembolsos da empresa"],
  ["pix.payment.receipt.print", "Imprimir comprovante Pix", "Imprimir comprovantes não fiscais de pagamentos confirmados"],
  ["integrations.read", "Consultar integrações", "Consultar o estado das integrações da empresa"],
  ["integrations.manage", "Gerenciar integrações", "Configurar credenciais e integrações da empresa"],
  ["dashboard.view", "Visualizar dashboard", "Acessar indicadores da empresa"],
  ["cash.manage", "Gerenciar caixa", "Abrir, movimentar e fechar caixas"],
  ["cash.register.read", "Consultar caixas", "Consultar caixas físicos e terminais"],
  ["cash.register.create", "Cadastrar caixas", "Cadastrar caixas físicos e terminais"],
  ["cash.register.update", "Editar caixas", "Alterar dados de caixas físicos e terminais"],
  ["cash.register.disable", "Desativar caixas", "Desativar caixas sem excluir seu histórico"],
  ["cash.session.open", "Abrir caixa", "Iniciar uma sessão operacional de caixa"],
  ["cash.session.read", "Consultar sessões de caixa", "Consultar sessões e totais de caixa"],
  ["cash.session.close", "Fechar caixa", "Encerrar uma sessão operacional de caixa"],
  ["cash.session.close.with_pending_charges", "Fechar caixa com Pix pendente", "Autorizar exceção auditada de fechamento com cobranças pendentes"],
  ["cash.movement.read", "Consultar movimentações", "Consultar movimentações de uma sessão de caixa"],
  ["cash.movement.supply", "Registrar suprimentos", "Adicionar numerário ao caixa"],
  ["cash.movement.withdrawal", "Registrar sangrias", "Retirar numerário disponível do caixa"],
  ["cash.movement.withdrawal.override", "Autorizar sangria excedente", "Autorizar sangria superior ao saldo disponível"],
  ["cash.reports.read", "Consultar relatórios de caixa", "Consultar histórico e relatórios operacionais de caixa"],
  ["reports.view", "Visualizar relatórios", "Consultar e exportar relatórios"],
  ["settings.manage", "Gerenciar configurações", "Alterar configurações da empresa"],
  ["users.manage", "Gerenciar usuários", "Criar e administrar usuários"],
  ["branches.manage", "Gerenciar filiais", "Criar e administrar filiais"],
  ["audit.read", "Consultar auditoria", "Consultar ações auditadas da empresa"],
  ["dashboard.read", "Consultar dashboard", "Consultar indicadores reais da empresa"],
  ["dashboard.financial.read", "Consultar indicadores financeiros", "Consultar valores e tendências financeiras"],
  ["dashboard.operator.read", "Consultar desempenho de operadores", "Consultar indicadores agregados por operador"],
  ["reports.sales.read", "Consultar relatórios de vendas", "Consultar vendas e cobranças com filtros"],
  ["reports.payments.read", "Consultar relatórios de pagamentos", "Consultar pagamentos e devoluções"],
  ["reports.cash.read", "Consultar relatórios de caixa", "Consultar sessões e movimentações"],
  ["reports.reconciliation.read", "Consultar conciliação", "Identificar inconsistências financeiras sem correção silenciosa"],
  ["reports.export", "Exportar relatórios", "Gerar arquivos CSV, XLSX e PDF auditados"],
  ["users.read", "Consultar usuários", "Listar usuários e seus acessos"],
  ["users.create", "Criar usuários", "Cadastrar usuários respeitando o plano"],
  ["users.update", "Editar usuários", "Editar perfil, filial e funções"],
  ["users.disable", "Desativar usuários", "Desativar e bloquear contas sem excluir histórico"],
  ["users.sessions.revoke", "Revogar sessões", "Revogar sessões ativas de usuários"],
  ["roles.read", "Consultar funções", "Consultar funções e permissões"],
  ["roles.create", "Criar funções", "Criar funções personalizadas"],
  ["roles.update", "Editar funções", "Editar permissões de funções"],
  ["roles.disable", "Desativar funções", "Desativar funções sem apagar histórico"],
  ["branches.read", "Consultar filiais", "Consultar filiais da empresa"],
  ["branches.create", "Criar filiais", "Cadastrar filiais respeitando o plano"],
  ["branches.update", "Editar filiais", "Editar identificação e endereço de filiais"],
  ["branches.disable", "Desativar filiais", "Desativar filiais sem sessões abertas"],
  ["settings.read", "Consultar configurações", "Consultar preferências operacionais"],
  ["settings.update", "Editar configurações", "Alterar preferências operacionais"],
  ["print.settings.read", "Consultar configurações de impressão", "Consultar template e pré-visualização"],
  ["print.settings.update", "Editar configurações de impressão", "Alterar cupom, logo e automações"],
  ["audit.details.read", "Consultar detalhes da auditoria", "Consultar alterações sanitizadas e correlação"],
  ["notifications.read", "Consultar notificações", "Consultar alertas operacionais e técnicos"],
  ["notifications.update", "Atualizar notificações", "Marcar alertas como lidos ou resolvidos"],
  ["platform.dashboard.read", "Consultar painel da plataforma", "Consultar indicadores globais da plataforma"],
  ["platform.companies.read", "Consultar empresas da plataforma", "Consultar empresas sem expor credenciais"],
  ["platform.companies.create", "Criar empresas", "Cadastrar empresas e assinatura inicial"],
  ["platform.companies.update", "Editar empresas", "Editar plano e limites de empresas"],
  ["platform.companies.suspend", "Suspender empresas", "Suspender e reativar empresas com auditoria"],
  ["platform.plans.manage", "Gerenciar planos", "Criar e editar planos e limites"],
  ["platform.health.read", "Consultar saúde da plataforma", "Consultar dependências sem expor segredos"],
] as const;

async function seed(): Promise<void> {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD deve ser informada com pelo menos 12 caracteres");
  }

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@bitpix.local").trim().toLowerCase();

  const defaultPlan = await prisma.plan.upsert({
    where: { key: "DEVELOPMENT" },
    create: { key: "DEVELOPMENT", name: "Desenvolvimento", description: "Plano local completo para homologação", price: 0, userLimit: 25, branchLimit: 10, cashRegisterLimit: 25, monthlyChargeLimit: 10000, monthlyExportLimit: 500, features: ["dashboard", "reports", "exports", "webhooks"] },
    update: { name: "Desenvolvimento", status: "ACTIVE", userLimit: 25, branchLimit: 10, cashRegisterLimit: 25, monthlyChargeLimit: 10000, monthlyExportLimit: 500 },
  });

  const company = await prisma.company.upsert({
    where: { slug: "loja-modelo" },
    create: {
      legalName: "Loja Modelo Desenvolvimento Ltda",
      displayName: "Loja Modelo",
      slug: "loja-modelo",
      planId: defaultPlan.id,
    },
    update: {
      displayName: "Loja Modelo",
      planId: defaultPlan.id,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: "MATRIZ" } },
    create: {
      companyId: company.id,
      code: "MATRIZ",
      name: "Loja Matriz",
    },
    update: { active: true, name: "Loja Matriz" },
  });

  const permissions = new Map<string, string>();
  for (const [key, name, description] of permissionCatalog) {
    const permission = await prisma.permission.upsert({
      where: { key },
      create: { key, name, description },
      update: { name, description },
    });
    permissions.set(key, permission.id);
  }

  const adminRole = await prisma.role.upsert({
    where: { companyId_key: { companyId: company.id, key: "ADMIN" } },
    create: { companyId: company.id, key: "ADMIN", name: "Administrador", isSystem: true },
    update: { name: "Administrador", isSystem: true },
  });

  const operatorRole = await prisma.role.upsert({
    where: { companyId_key: { companyId: company.id, key: "OPERATOR" } },
    create: { companyId: company.id, key: "OPERATOR", name: "Operador de caixa", isSystem: true },
    update: { name: "Operador de caixa", isSystem: true },
  });

  const managerRole = await prisma.role.upsert({
    where: { companyId_key: { companyId: company.id, key: "MANAGER" } },
    create: { companyId: company.id, key: "MANAGER", name: "Gerente", isSystem: true },
    update: { name: "Gerente", isSystem: true, active: true },
  });

  for (const [key, permissionId] of permissions.entries()) {
    if (key.startsWith("platform.")) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId } },
      create: { companyId: company.id, roleId: adminRole.id, permissionId },
      update: { companyId: company.id },
    });
  }

  const managerPermissionKeys = ["dashboard.read", "dashboard.financial.read", "dashboard.operator.read", "reports.sales.read", "reports.payments.read", "reports.cash.read", "reports.reconciliation.read", "reports.export", "sales.read", "pix.charge.read", "pix.payment.read", "cash.register.read", "cash.session.read", "cash.movement.read", "users.read", "branches.read", "settings.read", "print.settings.read", "audit.read", "notifications.read", "notifications.update"];
  for (const key of managerPermissionKeys) {
    const permissionId = permissions.get(key);
    if (permissionId) await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: managerRole.id, permissionId } }, create: { companyId: company.id, roleId: managerRole.id, permissionId }, update: { companyId: company.id } });
  }

  for (const key of [
    "sales.create",
    "sales.read",
    "pix.charge.create",
    "pix.charge.read",
    "pix.charge.cancel",
    "pix.charge.copy",
    "pix.charge.print",
    "pix.payment.read",
    "pix.payment.receipt.print",
    "cash.manage",
    "cash.register.read",
    "cash.session.open",
    "cash.session.read",
    "cash.session.close",
    "cash.movement.read",
    "cash.movement.supply",
    "cash.movement.withdrawal",
  ] as const) {
    const permissionId = permissions.get(key);
    if (!permissionId) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: operatorRole.id, permissionId } },
      create: { companyId: company.id, roleId: operatorRole.id, permissionId },
      update: { companyId: company.id },
    });
  }

  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
  const admin = await prisma.user.upsert({
    where: { normalizedEmail: adminEmail },
    create: {
      companyId: company.id,
      branchId: branch.id,
      name: "Administrador BitPix",
      email: adminEmail,
      normalizedEmail: adminEmail,
      passwordHash,
    },
    update: {
      companyId: company.id,
      branchId: branch.id,
      name: "Administrador BitPix",
      passwordHash,
      status: "ACTIVE",
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    create: { companyId: company.id, userId: admin.id, roleId: adminRole.id },
    update: { companyId: company.id },
  });

  const operatorEmail = "operador@bitpix.local";
  const operator = await prisma.user.upsert({
    where: { normalizedEmail: operatorEmail },
    create: {
      companyId: company.id,
      branchId: branch.id,
      name: "Operador de Caixa",
      email: operatorEmail,
      normalizedEmail: operatorEmail,
      passwordHash,
    },
    update: {
      companyId: company.id,
      branchId: branch.id,
      name: "Operador de Caixa",
      passwordHash,
      status: "ACTIVE",
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: operator.id, roleId: operatorRole.id } },
    create: { companyId: company.id, userId: operator.id, roleId: operatorRole.id },
    update: { companyId: company.id },
  });

  await prisma.cashRegister.upsert({
    where: {
      companyId_branchId_code: {
        companyId: company.id,
        branchId: branch.id,
        code: "CX-01",
      },
    },
    create: {
      companyId: company.id,
      branchId: branch.id,
      code: "CX-01",
      name: "Caixa principal",
      description: "Terminal principal da Loja Matriz",
    },
    update: { name: "Caixa principal", description: "Terminal principal da Loja Matriz", status: "ACTIVE" },
  });

  await prisma.subscription.upsert({
    where: { companyId: company.id },
    create: { companyId: company.id, planId: defaultPlan.id, status: "ACTIVE", currentPeriodEnd: new Date("2099-12-31T23:59:59.000Z") },
    update: { planId: defaultPlan.id, status: "ACTIVE" },
  });

  // E-mail Pix da empresa (payer.email padrão). Domínio real — nunca .local, que o
  // Mercado Pago recusa. Configurável depois em Configurações › Operação.
  const seedPixPayerEmail = process.env.SEED_PIX_PAYER_EMAIL ?? "pagador@lojamodelo.com.br";
  const seedQuickItems = [
    { name: "Café", amountInCents: 500 },
    { name: "Marmita", amountInCents: 2200 },
    { name: "Refrigerante", amountInCents: 700 },
  ];
  await prisma.companySetting.upsert({
    where: { companyId: company.id },
    create: { companyId: company.id, pixPayerEmail: seedPixPayerEmail, quickItems: seedQuickItems },
    update: { pixPayerEmail: seedPixPayerEmail, quickItems: seedQuickItems },
  });

  await prisma.printTemplate.upsert({
    where: { companyId_scopeKey: { companyId: company.id, scopeKey: "COMPANY" } },
    create: { companyId: company.id, scopeKey: "COMPANY", storeName: company.displayName, footer: "Obrigado pela preferência" },
    update: { storeName: company.displayName },
  });

  const platformCompany = await prisma.company.upsert({
    where: { slug: "bitpix-platform" },
    create: { legalName: "BitPix Plataforma", displayName: "BitPix Plataforma", slug: "bitpix-platform", planId: defaultPlan.id },
    update: { status: "ACTIVE", planId: defaultPlan.id },
  });
  const platformBranch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: platformCompany.id, code: "PLATFORM" } },
    create: { companyId: platformCompany.id, code: "PLATFORM", name: "Operação da plataforma" },
    update: { active: true },
  });
  const platformRole = await prisma.role.upsert({
    where: { companyId_key: { companyId: platformCompany.id, key: "SUPERADMIN" } },
    create: { companyId: platformCompany.id, key: "SUPERADMIN", name: "Superadministrador", isSystem: true },
    update: { active: true, isSystem: true },
  });
  for (const [key, permissionId] of permissions.entries()) {
    if (!key.startsWith("platform.")) continue;
    await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: platformRole.id, permissionId } }, create: { companyId: platformCompany.id, roleId: platformRole.id, permissionId }, update: { companyId: platformCompany.id } });
  }
  const superadminEmail = "superadmin@bitpix.local";
  const superadmin = await prisma.user.upsert({
    where: { normalizedEmail: superadminEmail },
    create: { companyId: platformCompany.id, branchId: platformBranch.id, name: "Superadministrador BitPix", email: superadminEmail, normalizedEmail: superadminEmail, passwordHash, isPlatformAdmin: true },
    update: { companyId: platformCompany.id, branchId: platformBranch.id, passwordHash, status: "ACTIVE", isPlatformAdmin: true },
  });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: superadmin.id, roleId: platformRole.id } }, create: { companyId: platformCompany.id, userId: superadmin.id, roleId: platformRole.id }, update: { companyId: platformCompany.id } });

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      branchId: branch.id,
      userId: admin.id,
      action: "system.seed",
      entity: "DevelopmentEnvironment",
      entityPublicId: company.publicId,
      outcome: AuditOutcome.SUCCESS,
      correlationId: randomUUID(),
      metadata: { environment: "development", credentialSource: "SEED_ADMIN_PASSWORD" },
    },
  });

  console.info(`Seed concluído para ${company.displayName} (${adminEmail})`);
}

seed()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Falha desconhecida no seed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
