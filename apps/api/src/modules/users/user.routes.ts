import { createUserSchema, paginationSchema, updateUserSchema } from "@bitpix/contracts";
import { prisma } from "@bitpix/database";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { requireAnyPermission } from "../auth/auth.guard.js";
import { enforceCompanyLimit } from "../platform/plan-limits.js";

const userQuery = paginationSchema.extend({ search: z.string().trim().max(120).optional(), status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).optional(), branchPublicId: z.uuid().optional() });
const userSelection = { publicId: true, name: true, email: true, status: true, mfaEnabled: true, mustResetPassword: true, lastLoginAt: true, createdAt: true, branch: { select: { publicId: true, name: true } }, roles: { select: { role: { select: { publicId: true, key: true, name: true } } } }, _count: { select: { sessions: { where: { revokedAt: null } } } } } as const;

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users", { preHandler: requireAnyPermission("users.read", "users.manage") }, async (request) => {
    const query = userQuery.parse(request.query); const companyId = request.auth!.companyId; const branch = query.branchPublicId ? await prisma.branch.findFirst({ where: { companyId, publicId: query.branchPublicId }, select: { id: true } }) : null;
    if (query.branchPublicId && !branch) throw new AppError(400, "BRANCH_INVALID", "A filial informada não pertence à empresa.");
    const where = { companyId, ...(query.status ? { status: query.status } : {}), ...(branch ? { branchId: branch.id } : {}), ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" as const } }, { email: { contains: query.search, mode: "insensitive" as const } }] } : {}) };
    const [users, total] = await Promise.all([prisma.user.findMany({ where, select: userSelection, orderBy: { name: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), prisma.user.count({ where })]);
    return { data: users.map((user) => ({ ...user, lastLoginAt: user.lastLoginAt?.toISOString() ?? null, createdAt: user.createdAt.toISOString(), activeSessionCount: user._count.sessions, _count: undefined })), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  });

  app.get<{ Params: { publicId: string } }>("/users/:publicId", { preHandler: requireAnyPermission("users.read", "users.manage") }, async (request) => {
    const user = await prisma.user.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId }, select: userSelection }); if (!user) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado."); return { data: user };
  });

  app.post("/users", { preHandler: requireAnyPermission("users.create", "users.manage") }, async (request, reply) => {
    const body = createUserSchema.parse(request.body); const auth = request.auth!; await enforceCompanyLimit(auth.companyId, "users");
    if (await prisma.user.findUnique({ where: { normalizedEmail: body.email } })) throw new AppError(409, "USER_EMAIL_EXISTS", "Já existe um usuário com este e-mail.");
    const [branch, roles] = await Promise.all([body.branchPublicId ? prisma.branch.findFirst({ where: { publicId: body.branchPublicId, companyId: auth.companyId, active: true } }) : null, prisma.role.findMany({ where: { companyId: auth.companyId, key: { in: body.roleKeys }, active: true } })]);
    if (body.branchPublicId && !branch) throw new AppError(400, "BRANCH_INVALID", "A filial informada não pertence à empresa."); if (roles.length !== new Set(body.roleKeys).size) throw new AppError(400, "ROLE_INVALID", "Uma ou mais funções são inválidas.");
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const user = await prisma.$transaction(async (tx) => { const created = await tx.user.create({ data: { companyId: auth.companyId, branchId: branch?.id ?? null, name: body.name, email: body.email, normalizedEmail: body.email, passwordHash, mustResetPassword: true } }); await tx.userRole.createMany({ data: roles.map((role) => ({ companyId: auth.companyId, userId: created.id, roleId: role.id })) }); await writeAudit({ request, client: tx, action: "user.created", entity: "User", entityPublicId: created.publicId, after: { name: created.name, email: created.email, roles: roles.map((role) => role.key) } }); return created; });
    return reply.status(201).send({ data: { publicId: user.publicId, name: user.name, email: user.email, status: user.status } });
  });

  app.patch<{ Params: { publicId: string } }>("/users/:publicId", { preHandler: requireAnyPermission("users.update", "users.disable", "users.manage") }, async (request) => {
    const body = updateUserSchema.parse(request.body); const auth = request.auth!; const current = await prisma.user.findFirst({ where: { publicId: request.params.publicId, companyId: auth.companyId }, include: { roles: { include: { role: true } } } }); if (!current) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
    if (current.id === auth.userId && body.status && body.status !== "ACTIVE") throw new AppError(409, "SELF_DISABLE_FORBIDDEN", "Você não pode desativar a própria conta.");
    if (body.email && body.email !== current.normalizedEmail && await prisma.user.findUnique({ where: { normalizedEmail: body.email } })) throw new AppError(409, "USER_EMAIL_EXISTS", "Já existe um usuário com este e-mail.");
    const branch = body.branchPublicId === undefined ? undefined : body.branchPublicId === null ? null : await prisma.branch.findFirst({ where: { companyId: auth.companyId, publicId: body.branchPublicId, active: true } }); if (body.branchPublicId && !branch) throw new AppError(400, "BRANCH_INVALID", "Filial inválida.");
    const roles = body.roleKeys ? await prisma.role.findMany({ where: { companyId: auth.companyId, key: { in: body.roleKeys }, active: true } }) : undefined; if (body.roleKeys && roles!.length !== new Set(body.roleKeys).size) throw new AppError(400, "ROLE_INVALID", "Função inválida.");
    const updated = await prisma.$transaction(async (tx) => { const saved = await tx.user.update({ where: { id: current.id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.email ? { email: body.email, normalizedEmail: body.email } : {}), ...(body.status ? { status: body.status, ...(body.status === "ACTIVE" ? { lockedUntil: null, failedLoginAttempts: 0 } : {}) } : {}), ...(body.mustResetPassword === undefined ? {} : { mustResetPassword: body.mustResetPassword }), ...(branch === undefined ? {} : { branchId: branch?.id ?? null }) } }); if (roles) { await tx.userRole.deleteMany({ where: { userId: current.id } }); await tx.userRole.createMany({ data: roles.map((role) => ({ companyId: auth.companyId, userId: current.id, roleId: role.id })) }); } if (body.status && body.status !== "ACTIVE") await tx.userSession.updateMany({ where: { userId: current.id, revokedAt: null }, data: { revokedAt: new Date() } }); await writeAudit({ request, client: tx, action: "user.updated", entity: "User", entityPublicId: saved.publicId, before: { name: current.name, email: current.email, status: current.status, roles: current.roles.map((item) => item.role.key) }, after: { name: saved.name, email: saved.email, status: saved.status, roles: roles?.map((role) => role.key) } }); return saved; }); return { data: { publicId: updated.publicId, name: updated.name, email: updated.email, status: updated.status } };
  });

  app.post<{ Params: { publicId: string } }>("/users/:publicId/revoke-sessions", { preHandler: requireAnyPermission("users.sessions.revoke", "users.manage") }, async (request) => {
    const user = await prisma.user.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId }, select: { id: true, publicId: true } }); if (!user) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado."); const result = await prisma.userSession.updateMany({ where: { userId: user.id, revokedAt: null, ...(user.id === request.auth!.userId ? { id: { not: request.auth!.sessionId } } : {}) }, data: { revokedAt: new Date() } }); await writeAudit({ request, action: "user.sessions.revoked", entity: "User", entityPublicId: user.publicId, metadata: { count: result.count } }); return { data: { revoked: result.count } };
  });
}
