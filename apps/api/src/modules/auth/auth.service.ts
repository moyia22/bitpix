import { createHash, randomBytes } from "node:crypto";
import type { PermissionKey, SessionPrincipal } from "@bitpix/contracts";
import { CompanyStatus, prisma, UserStatus } from "@bitpix/database";
import argon2 from "argon2";
import type { FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { AppError, unauthorized } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { requiresMfa } from "./mfa-policy.js";
import { verifyMfaForLogin } from "./mfa.service.js";

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export async function login(
  request: FastifyRequest,
  email: string,
  password: string,
  mfaCode?: string,
  recoveryCode?: string,
): Promise<{ token: string; principal: SessionPrincipal }> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { normalizedEmail },
    include: {
      company: true,
      branch: true,
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  const now = new Date();
  if (user?.lockedUntil && user.lockedUntil > now) {
    await writeAudit({
      request,
      action: "auth.login.failed",
      entity: "User",
      entityPublicId: user.publicId,
      outcome: "FAILURE",
      companyId: user.companyId,
      branchId: user.branchId,
      userId: user.id,
      metadata: { reason: "locked" },
    });
    throw new AppError(429, "AUTH_LOCKED", "Acesso temporariamente bloqueado. Tente novamente mais tarde.");
  }

  const passwordMatches = user ? await argon2.verify(user.passwordHash, password) : false;
  if (!user || !passwordMatches) {
    if (user) {
      const attempts = user.failedLoginAttempts + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil: attempts >= MAX_LOGIN_ATTEMPTS
            ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000)
            : null,
        },
      });
    }

    await writeAudit({
      request,
      action: "auth.login.failed",
      entity: "User",
      ...(user ? { entityPublicId: user.publicId } : {}),
      outcome: "FAILURE",
      companyId: user?.companyId ?? null,
      branchId: user?.branchId ?? null,
      userId: user?.id ?? null,
      metadata: { reason: "invalid_credentials", email: normalizedEmail.replace(/(^.).*(@.*$)/, "$1***$2") },
    });
    throw unauthorized();
  }

  if (user.status !== UserStatus.ACTIVE || user.company.status !== CompanyStatus.ACTIVE) {
    throw new AppError(403, "ACCOUNT_DISABLED", "A conta ou empresa está suspensa.");
  }

  const permissionKeysForUser = user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key));
  const mustEnrollMfa = (env.REQUIRE_MFA_FOR_PLATFORM || env.REQUIRE_MFA_FOR_ADMINS)
    && requiresMfa(user, permissionKeysForUser)
    && !user.mfaEnabled;

  if (user.mfaEnabled) {
    if (!mfaCode && !recoveryCode) throw new AppError(428, "MFA_REQUIRED", "Informe o código do autenticador.");
    if (!await verifyMfaForLogin(user, mfaCode, recoveryCode)) {
      await writeAudit({ request, action: "auth.mfa.failed", entity: "User", entityPublicId: user.publicId, outcome: "FAILURE", companyId: user.companyId, branchId: user.branchId, userId: user.id });
      throw new AppError(401, "MFA_INVALID", "Código de autenticação inválido.");
    }
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = addHours(now, env.SESSION_TTL_HOURS);

  const session = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
    });
    return tx.userSession.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        tokenHash,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"]?.slice(0, 320) ?? null,
        expiresAt,
      },
    });
  });

  const roles = user.roles.map(({ role }) => role.key);
  const permissions = [
    ...new Set(
      user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)),
    ),
  ] as PermissionKey[];

  const principal: SessionPrincipal = {
    user: { publicId: user.publicId, name: user.name, email: user.email },
    company: {
      publicId: user.company.publicId,
      displayName: user.company.displayName,
      slug: user.company.slug,
    },
    branch: user.branch
      ? { publicId: user.branch.publicId, name: user.branch.name }
      : null,
    roles,
    permissions,
    sessionExpiresAt: session.expiresAt.toISOString(),
    mfaEnrollmentPending: mustEnrollMfa,
    mustResetPassword: user.mustResetPassword,
  };

  await writeAudit({
    request,
    action: "auth.login.succeeded",
    entity: "UserSession",
    entityPublicId: session.publicId,
    companyId: user.companyId,
    branchId: user.branchId,
    userId: user.id,
  });

  return { token, principal };
}
