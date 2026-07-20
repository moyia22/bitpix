import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@bitpix/database";
import argon2 from "argon2";
import type { FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { sendMail } from "../../lib/mail.js";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requestPasswordReset(request: FastifyRequest, email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { normalizedEmail: email } });
  if (!user) return;
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), requestedIp: request.ip, expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000) } });
  });
  const resetUrl = `${env.APP_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
  await sendMail({ to: user.email, subject: "Redefinição de senha do BitPix", text: `Recebemos uma solicitação para redefinir sua senha. Use este link nos próximos ${env.PASSWORD_RESET_TTL_MINUTES} minutos:\n\n${resetUrl}\n\nSe você não fez esta solicitação, ignore esta mensagem.` });
  await writeAudit({ request, action: "auth.password_reset.requested", entity: "User", entityPublicId: user.publicId, companyId: user.companyId, userId: user.id });
}

export async function resetPassword(request: FastifyRequest, token: string, password: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) throw new AppError(400, "PASSWORD_RESET_INVALID", "Link inválido ou expirado.");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError(400, "PASSWORD_RESET_INVALID", "Link inválido ou expirado.");
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash, mustResetPassword: false, failedLoginAttempts: 0, lockedUntil: null } });
    await tx.userSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  await writeAudit({ request, action: "auth.password_reset.completed", entity: "User", entityPublicId: record.user.publicId, companyId: record.user.companyId, userId: record.userId });
}
