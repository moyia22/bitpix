import type { PermissionKey, SessionPrincipal } from "@bitpix/contracts";
import { AuditOutcome, CompanyStatus, prisma, UserStatus } from "@bitpix/database";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { AppError, forbidden, unauthorized } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { hashSessionToken } from "./auth.service.js";
import { requiresMfa } from "./mfa-policy.js";

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = request.cookies[env.SESSION_COOKIE_NAME];
  if (!token) throw unauthorized();

  const tokenHash = hashSessionToken(token);
  const session = await prisma.userSession.findUnique({
    where: { tokenHash },
    // Carrega sessão + empresa + usuário + filial + funções + permissões em UMA
    // única query (LATERAL JOIN) em vez de ~8 round-trips ao banco.
    relationLoadStrategy: "join",
    include: {
      company: true,
      user: {
        include: {
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
      },
    },
  });

  const now = new Date();
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.user.status !== UserStatus.ACTIVE ||
    session.company.status !== CompanyStatus.ACTIVE
  ) {
    throw unauthorized();
  }

  const roles = session.user.roles.map(({ role }) => role.key);
  const permissionList = [
    ...new Set(
      session.user.roles.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => permission.key),
      ),
    ),
  ] as PermissionKey[];

  const principal: SessionPrincipal = {
    user: {
      publicId: session.user.publicId,
      name: session.user.name,
      email: session.user.email,
    },
    company: {
      publicId: session.company.publicId,
      displayName: session.company.displayName,
      slug: session.company.slug,
    },
    branch: session.user.branch
      ? { publicId: session.user.branch.publicId, name: session.user.branch.name }
      : null,
    roles,
    permissions: permissionList,
    sessionExpiresAt: session.expiresAt.toISOString(),
    mfaEnrollmentPending: (env.REQUIRE_MFA_FOR_PLATFORM || env.REQUIRE_MFA_FOR_ADMINS) && requiresMfa(session.user, permissionList) && !session.user.mfaEnabled,
    mustResetPassword: session.user.mustResetPassword,
  };

  request.auth = {
    sessionId: session.id,
    sessionTokenHash: tokenHash,
    userId: session.userId,
    companyId: session.companyId,
    branchId: session.user.branchId,
    permissions: new Set(permissionList),
    principal,
  };

  const path = request.url.split("?")[0] ?? request.url;
  const enrollmentAllow = ["/api/v1/auth/mfa/setup", "/api/v1/auth/mfa/confirm", "/api/v1/auth/mfa/status", "/api/v1/auth/me", "/api/v1/auth/logout"];
  const resetAllow = ["/api/v1/auth/password/change", "/api/v1/auth/me", "/api/v1/auth/logout"];
  if (principal.mfaEnrollmentPending && !enrollmentAllow.includes(path)) {
    throw new AppError(403, "MFA_ENROLLMENT_REQUIRED", "Configure o 2FA para continuar.");
  }
  if (principal.mustResetPassword && !resetAllow.includes(path)) {
    throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Redefina sua senha para continuar.");
  }

  if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
}

export function requirePermission(permission: PermissionKey) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (!request.auth?.permissions.has(permission)) {
      await writeAudit({
        request,
        action: "authorization.denied",
        entity: "Permission",
        entityPublicId: permission,
        outcome: AuditOutcome.FAILURE,
        metadata: { permission, method: request.method, route: request.routeOptions.url },
      });
      throw forbidden();
    }
  };
}

export function requireAnyPermission(...permissions: PermissionKey[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (!permissions.some((permission) => request.auth?.permissions.has(permission))) {
      await writeAudit({ request, action: "authorization.denied", entity: "Permission", outcome: AuditOutcome.FAILURE, metadata: { permissions, method: request.method, route: request.routeOptions.url } });
      throw forbidden();
    }
  };
}
