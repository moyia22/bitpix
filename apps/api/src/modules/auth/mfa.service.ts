import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@bitpix/database";
import argon2 from "argon2";
import QRCode from "qrcode";
import type { FastifyRequest } from "fastify";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { decryptSecret, encryptSecret } from "../../lib/secret-vault.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp.js";

function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function recoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const value = randomBytes(5).toString("hex").toUpperCase().slice(0, 8);
    return `${value.slice(0, 4)}-${value.slice(4)}`;
  });
}

async function authenticatedUser(request: FastifyRequest) {
  const auth = request.auth;
  if (!auth) throw new AppError(401, "AUTH_INVALID", "Sessão inválida.");
  const user = await prisma.user.findFirst({ where: { id: auth.userId, companyId: auth.companyId } });
  if (!user) throw new AppError(401, "AUTH_INVALID", "Sessão inválida.");
  return user;
}

function readSecret(user: {
  id: string;
  mfaSecretCiphertext: string | null;
  mfaSecretIv: string | null;
  mfaSecretAuthTag: string | null;
}): string {
  if (!user.mfaSecretCiphertext || !user.mfaSecretIv || !user.mfaSecretAuthTag) {
    throw new AppError(409, "MFA_SETUP_REQUIRED", "Inicie novamente a configuração do MFA.");
  }
  return decryptSecret({
    ciphertext: user.mfaSecretCiphertext,
    iv: user.mfaSecretIv,
    authTag: user.mfaSecretAuthTag,
  }, `mfa:${user.id}`);
}

export async function beginMfaSetup(request: FastifyRequest, password: string) {
  const user = await authenticatedUser(request);
  if (!await argon2.verify(user.passwordHash, password)) {
    throw new AppError(401, "PASSWORD_INVALID", "Senha atual inválida.");
  }
  const secret = generateTotpSecret();
  const encrypted = encryptSecret(secret, `mfa:${user.id}`);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaEnabled: false,
      mfaConfirmedAt: null,
      mfaSecretCiphertext: encrypted.ciphertext,
      mfaSecretIv: encrypted.iv,
      mfaSecretAuthTag: encrypted.authTag,
    },
  });
  const uri = otpauthUri(secret, user.email);
  await writeAudit({ request, action: "auth.mfa.setup.started", entity: "User", entityPublicId: user.publicId });
  return { secret, otpauthUri: uri, qrCodeDataUrl: await QRCode.toDataURL(uri) };
}

export async function confirmMfaSetup(request: FastifyRequest, code: string): Promise<{ recoveryCodes: string[] }> {
  const user = await authenticatedUser(request);
  if (!verifyTotp(readSecret(user), code)) throw new AppError(401, "MFA_INVALID", "Código de autenticação inválido.");
  const codes = recoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.mfaRecoveryCode.createMany({ data: codes.map((value) => ({ userId: user.id, codeHash: hashRecoveryCode(value) })) });
    await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaConfirmedAt: new Date(), recoveryCodesVersion: { increment: 1 } } });
  });
  await writeAudit({ request, action: "auth.mfa.enabled", entity: "User", entityPublicId: user.publicId });
  return { recoveryCodes: codes };
}

export async function disableMfa(request: FastifyRequest, password: string, code: string): Promise<void> {
  const user = await authenticatedUser(request);
  if (!await argon2.verify(user.passwordHash, password) || !verifyTotp(readSecret(user), code)) {
    throw new AppError(401, "MFA_INVALID", "Senha ou código de autenticação inválido.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaConfirmedAt: null, mfaSecretCiphertext: null, mfaSecretIv: null, mfaSecretAuthTag: null } });
    await tx.userSession.updateMany({ where: { userId: user.id, id: { not: request.auth!.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  await writeAudit({ request, action: "auth.mfa.disabled", entity: "User", entityPublicId: user.publicId });
}

export async function verifyMfaForLogin(user: {
  id: string;
  mfaSecretCiphertext: string | null;
  mfaSecretIv: string | null;
  mfaSecretAuthTag: string | null;
}, code?: string, recoveryCode?: string): Promise<boolean> {
  if (code) return verifyTotp(readSecret(user), code);
  if (!recoveryCode) return false;
  const codeHash = hashRecoveryCode(recoveryCode);
  const result = await prisma.mfaRecoveryCode.updateMany({
    where: { userId: user.id, codeHash, usedAt: null },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}

export async function assertStepUpMfa(request: FastifyRequest, code?: string): Promise<void> {
  const user = await authenticatedUser(request);
  if (!user.mfaEnabled) throw new AppError(403, "MFA_SETUP_REQUIRED", "Ative o 2FA para executar esta ação.");
  if (!code) throw new AppError(428, "MFA_REQUIRED", "Informe o código do autenticador.");
  if (!verifyTotp(readSecret(user), code)) throw new AppError(401, "MFA_INVALID", "Código de autenticação inválido.");
}
