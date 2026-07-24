import { randomUUID } from "node:crypto";
import { createUserSchema, deleteUserSchema, paginationSchema, resetMfaSchema, setPasswordSchema, updateUserSchema } from "@bitpix/contracts";
import { CashRegisterStatus, Prisma, prisma } from "@bitpix/database";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { assertStepUpMfa } from "../auth/mfa.service.js";
import { requireAnyPermission } from "../auth/auth.guard.js";
import { enforceCompanyLimit } from "../platform/plan-limits.js";

const userQuery = paginationSchema.extend({ search: z.string().trim().max(120).optional(), status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).optional(), branchPublicId: z.uuid().optional() });
const userSelection = { publicId: true, name: true, email: true, status: true, mfaEnabled: true, mustResetPassword: true, lastLoginAt: true, createdAt: true, branch: { select: { publicId: true, name: true } }, roles: { select: { role: { select: { publicId: true, key: true, name: true } } } }, _count: { select: { sessions: { where: { revokedAt: null } } } } } as const;

// Cada usuário tem um caixa próprio (1:1). Resolve a filial do caixa: a do usuário
// ou a primeira filial ativa da empresa. Falha explicitamente se não houver filial.
async function resolveCashBranchId(tx: Prisma.TransactionClient, companyId: string, userBranchId: string | null): Promise<string> {
  if (userBranchId) return userBranchId;
  const branch = await tx.branch.findFirst({ where: { companyId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!branch) throw new AppError(409, "NO_ACTIVE_BRANCH", "Cadastre uma filial ativa antes de criar usuários (cada usuário recebe um caixa).");
  return branch.id;
}

// Gera um código de caixa único dentro da filial (CX-1, CX-2, ...).
async function generateRegisterCode(tx: Prisma.TransactionClient, companyId: string, branchId: string): Promise<string> {
  const base = await tx.cashRegister.count({ where: { companyId, branchId } });
  for (let i = 1; i <= 200; i += 1) {
    const code = `CX-${base + i}`;
    const taken = await tx.cashRegister.findFirst({ where: { companyId, branchId, code }, select: { id: true } });
    if (!taken) return code;
  }
  return `CX-${randomUUID().slice(0, 6).toUpperCase()}`;
}

// Provisiona o caixa dedicado de um usuário recém-criado (dono 1:1).
async function provisionUserCashRegister(tx: Prisma.TransactionClient, companyId: string, user: { id: string; name: string; branchId: string | null }): Promise<void> {
  const branchId = await resolveCashBranchId(tx, companyId, user.branchId);
  const code = await generateRegisterCode(tx, companyId, branchId);
  await tx.cashRegister.create({ data: { companyId, branchId, code, name: `Caixa de ${user.name}`.slice(0, 100), ownerUserId: user.id } });
}

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
    const user = await prisma.$transaction(async (tx) => { const created = await tx.user.create({ data: { companyId: auth.companyId, branchId: branch?.id ?? null, name: body.name, email: body.email, normalizedEmail: body.email, passwordHash, mustResetPassword: body.requirePasswordChange ?? false } }); await tx.userRole.createMany({ data: roles.map((role) => ({ companyId: auth.companyId, userId: created.id, roleId: role.id })) }); await provisionUserCashRegister(tx, auth.companyId, created); await writeAudit({ request, client: tx, action: "user.created", entity: "User", entityPublicId: created.publicId, after: { name: created.name, email: created.email, roles: roles.map((role) => role.key) } }); return created; });
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

  app.post<{ Params: { publicId: string } }>("/users/:publicId/set-password", { preHandler: requireAnyPermission("users.update", "users.manage") }, async (request, reply) => {
    const body = setPasswordSchema.parse(request.body);
    const auth = request.auth!;
    await assertStepUpMfa(request, body.mfaCode);
    const user = await prisma.user.findFirst({ where: { publicId: request.params.publicId, companyId: auth.companyId }, select: { id: true, publicId: true } });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
    if (user.id === auth.userId) throw new AppError(409, "SELF_PASSWORD_FORBIDDEN", "Use a troca de senha da sua própria conta.");
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustResetPassword: body.requirePasswordChange ?? false, failedLoginAttempts: 0, lockedUntil: null } });
      await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeAudit({ request, client: tx, action: "user.password.set", entity: "User", entityPublicId: user.publicId, metadata: { requirePasswordChange: body.requirePasswordChange ?? false } });
    });
    return reply.status(204).send();
  });

  app.delete<{ Params: { publicId: string } }>("/users/:publicId", { preHandler: requireAnyPermission("users.disable", "users.manage") }, async (request) => {
    const body = deleteUserSchema.parse(request.body);
    const auth = request.auth!;
    await assertStepUpMfa(request, body.mfaCode);
    const user = await prisma.user.findFirst({ where: { publicId: request.params.publicId, companyId: auth.companyId }, select: { id: true, publicId: true, name: true, email: true } });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
    if (user.id === auth.userId) throw new AppError(409, "SELF_DELETE_FORBIDDEN", "Você não pode excluir a própria conta.");

    // Exclusão = anonimização. O histórico financeiro/auditoria é preservado (referências
    // permanecem apontando para este registro anonimizado), mas a identidade, o acesso e o
    // caixa do usuário são removidos. O caixa é apagado se não tiver histórico; caso contrário,
    // fica sem dono e inativo (preserva as sessões passadas).
    const deadHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
    const owned = await prisma.cashRegister.findFirst({ where: { ownerUserId: user.id }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      if (owned) {
        const sessionCount = await tx.cashSession.count({ where: { cashRegisterId: owned.id } });
        if (sessionCount === 0) await tx.cashRegister.delete({ where: { id: owned.id } });
        else await tx.cashRegister.update({ where: { id: owned.id }, data: { ownerUserId: null, status: CashRegisterStatus.INACTIVE } });
      }
      await tx.userRole.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.userSession.deleteMany({ where: { userId: user.id } });
      const tombstone = `removed+${user.publicId}@removed.invalid`;
      await tx.user.update({
        where: { id: user.id },
        data: {
          name: "Usuário removido",
          email: tombstone,
          normalizedEmail: tombstone,
          passwordHash: deadHash,
          status: "INACTIVE",
          mfaEnabled: false, mfaConfirmedAt: null, mfaSecretCiphertext: null, mfaSecretIv: null, mfaSecretAuthTag: null,
          mustResetPassword: false, failedLoginAttempts: 0, lockedUntil: null,
        },
      });
      await writeAudit({ request, client: tx, action: "user.deleted", entity: "User", entityPublicId: user.publicId, before: { name: user.name, email: user.email } });
    });
    return { data: { deleted: true, deactivated: false } };
  });

  app.post<{ Params: { publicId: string } }>("/users/:publicId/reset-mfa", { preHandler: requireAnyPermission("users.update", "users.manage") }, async (request) => {
    const body = resetMfaSchema.parse(request.body);
    const auth = request.auth!;
    await assertStepUpMfa(request, body.mfaCode);
    const user = await prisma.user.findFirst({ where: { publicId: request.params.publicId, companyId: auth.companyId }, select: { id: true, publicId: true } });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
    if (user.id === auth.userId) throw new AppError(409, "SELF_MFA_RESET_FORBIDDEN", "Gerencie o próprio 2FA na tela de segurança.");
    await prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaConfirmedAt: null, mfaSecretCiphertext: null, mfaSecretIv: null, mfaSecretAuthTag: null } });
      await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeAudit({ request, client: tx, action: "user.mfa.reset", entity: "User", entityPublicId: user.publicId });
    });
    return { data: { reset: true } };
  });
}
