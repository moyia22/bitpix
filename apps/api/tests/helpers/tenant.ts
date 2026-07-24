import { randomUUID } from "node:crypto";
import { prisma } from "@bitpix/database";
import argon2 from "argon2";
import { encryptSecret } from "../../src/lib/secret-vault.js";
import { generateTotpSecret } from "../../src/modules/auth/totp.js";

// REGRA INVIOLÁVEL DOS TESTES: nunca tocar em contas reais/seed (admin@bitpix.local,
// operador@bitpix.local, superadmin@bitpix.local). Os testes rodam contra o banco
// compartilhado — mutar usuários reais já apagou o 2FA do admin em produção.
// Todo teste de integração cria seu PRÓPRIO tenant com este helper e limpa tudo.

const ADMIN_PERMISSIONS = [
  "users.read", "users.create", "users.update", "users.disable", "users.manage",
  "users.sessions.revoke", "roles.read",
] as const;
const OPERATOR_PERMISSIONS = ["sales.create", "pix.charge.create"] as const;

export interface TestTenant {
  suffix: string;
  companyId: string;
  companySlug: string;
  password: string;
  adminEmail: string;
  operatorEmail: string;
  adminId: string;
  operatorId: string;
  adminPublicId: string;
  operatorPublicId: string;
  cleanup(): Promise<void>;
}

export async function createTestTenant(prefix: string): Promise<TestTenant> {
  const suffix = randomUUID().slice(0, 8);
  const password = `Senha-${suffix}-Forte1`;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const slug = `${prefix}-${suffix}`;

  const company = await prisma.company.create({ data: { legalName: `${prefix} ${suffix} Ltda`, displayName: `${prefix} ${suffix}`, slug } });
  const branch = await prisma.branch.create({ data: { companyId: company.id, code: "MATRIZ", name: "Matriz de teste" } });
  const adminRole = await prisma.role.create({ data: { companyId: company.id, key: "ADMIN", name: "Admin de teste" } });
  const operatorRole = await prisma.role.create({ data: { companyId: company.id, key: "OPERATOR", name: "Operador de teste" } });
  for (const [role, keys] of [[adminRole, ADMIN_PERMISSIONS], [operatorRole, OPERATOR_PERMISSIONS]] as const) {
    for (const key of keys) {
      const permission = await prisma.permission.upsert({ where: { key }, create: { key, name: key, description: key }, update: {} });
      await prisma.rolePermission.create({ data: { companyId: company.id, roleId: role.id, permissionId: permission.id } });
    }
  }

  const adminEmail = `${prefix}-adm-${suffix}@test.local`;
  const operatorEmail = `${prefix}-op-${suffix}@test.local`;
  const admin = await prisma.user.create({ data: { companyId: company.id, branchId: branch.id, name: "Admin de Teste", email: adminEmail, normalizedEmail: adminEmail, passwordHash } });
  await prisma.userRole.create({ data: { companyId: company.id, userId: admin.id, roleId: adminRole.id } });
  const operator = await prisma.user.create({ data: { companyId: company.id, branchId: branch.id, name: "Operador de Teste", email: operatorEmail, normalizedEmail: operatorEmail, passwordHash } });
  await prisma.userRole.create({ data: { companyId: company.id, userId: operator.id, roleId: operatorRole.id } });

  return {
    suffix,
    companyId: company.id,
    companySlug: slug,
    password,
    adminEmail,
    operatorEmail,
    adminId: admin.id,
    operatorId: operator.id,
    adminPublicId: admin.publicId,
    operatorPublicId: operator.publicId,
    async cleanup() {
      const companyId = company.id;
      await prisma.auditLog.deleteMany({ where: { companyId } });
      await prisma.mfaRecoveryCode.deleteMany({ where: { user: { companyId } } });
      await prisma.passwordResetToken.deleteMany({ where: { user: { companyId } } });
      await prisma.userSession.deleteMany({ where: { companyId } });
      await prisma.userRole.deleteMany({ where: { companyId } });
      await prisma.rolePermission.deleteMany({ where: { companyId } });
      await prisma.role.deleteMany({ where: { companyId } });
      // Caixas são auto-provisionados por usuário: limpar antes de users/branch (FK).
      await prisma.cashMovement.deleteMany({ where: { companyId } });
      await prisma.cashSession.deleteMany({ where: { companyId } });
      await prisma.cashRegister.deleteMany({ where: { companyId } });
      await prisma.user.deleteMany({ where: { companyId } });
      await prisma.branch.deleteMany({ where: { companyId } });
      await prisma.companySetting.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    },
  };
}

// Ativa o 2FA diretamente num usuário DE TESTE e devolve o segredo TOTP.
export async function enableTestMfa(userId: string): Promise<string> {
  const secret = generateTotpSecret();
  const encrypted = encryptSecret(secret, `mfa:${userId}`);
  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: true, mfaConfirmedAt: new Date(), mfaSecretCiphertext: encrypted.ciphertext, mfaSecretIv: encrypted.iv, mfaSecretAuthTag: encrypted.authTag },
  });
  return secret;
}
