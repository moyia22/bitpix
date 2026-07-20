import type { PermissionKey, SessionPrincipal } from "@bitpix/contracts";
import { AuditOutcome, CompanyStatus, prisma, UserStatus } from "@bitpix/database";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { forbidden, unauthorized } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { hashSessionToken } from "./auth.service.js";

const ADMIN_PERMISSION_PREFIXES = ["users.", "roles."] as const;

export function requiresMfa(user: { isPlatformAdmin: boolean }, permissions: Iterable<string>): boolean {
  if (user.isPlatformAdmin) return true;
  for (const permission of permissions) {
    if (ADMIN_PERMISSION_PREFIXES.some((prefix) => permission.startsWith(prefix))) return true;
  }
  return false;
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = request.cookies[env.SESSION_COOKIE_NAME];
  if (!token) throw unauthorized();

  const tokenHash = hashSessionToken(token);
  const session = await prisma.userSession.findUnique({
    where: { tokenHash },
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
