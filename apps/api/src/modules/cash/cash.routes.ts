import {
  cashMovementCreateSchema,
  cashRegisterCreateSchema,
  cashRegisterUpdateSchema,
  cashSessionListQuerySchema,
  closeCashSessionSchema,
  openCashSessionSchema,
  paginationSchema,
} from "@bitpix/contracts";
import {
  AuditOutcome,
  CashMovementDirection,
  CashMovementSourceType,
  CashMovementType,
  CashRegisterStatus,
  CashSessionStatus,
  NotificationType,
  PixChargeStatus,
  Prisma,
  prisma,
} from "@bitpix/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { requirePermission } from "../auth/auth.guard.js";
import { enforceCompanyLimit } from "../platform/plan-limits.js";
import {
  accessibleBranchWhere,
  auditScopedAccessDenied,
  cashRegisterSelect,
  cashSessionInclude,
  getCashTotals,
  isUniqueConstraintError,
  moneyFromCents,
  moneyToString,
  serializeCashSession,
} from "./cash.service.js";

async function findScopedRegister(request: FastifyRequest, publicId: string) {
  const auth = request.auth!;
  const cashRegister = await prisma.cashRegister.findFirst({
    where: {
      publicId,
      companyId: auth.companyId,
      ...accessibleBranchWhere(auth.branchId),
    },
    include: { branch: true },
  });
  if (!cashRegister) {
    await auditScopedAccessDenied(request, "CashRegister", publicId);
    throw new AppError(404, "CASH_REGISTER_NOT_FOUND", "Caixa não encontrado.");
  }
  return cashRegister;
}

async function findScopedSession(request: FastifyRequest, publicId: string) {
  const auth = request.auth!;
  const session = await prisma.cashSession.findFirst({
    where: {
      publicId,
      companyId: auth.companyId,
      ...accessibleBranchWhere(auth.branchId),
    },
    include: cashSessionInclude,
  });
  if (!session) {
    await auditScopedAccessDenied(request, "CashSession", publicId);
    throw new AppError(404, "CASH_SESSION_NOT_FOUND", "Sessão de caixa não encontrada.");
  }
  return session;
}

async function auditClosedMovementAttempt(request: FastifyRequest, publicId: string): Promise<void> {
  await writeAudit({
    request,
    action: "cash.movement.denied.closed",
    entity: "CashSession",
    entityPublicId: publicId,
    outcome: AuditOutcome.FAILURE,
    metadata: { reason: "session_closed" },
  });
}

function registerResponse(register: {
  publicId: string;
  code: string;
  name: string;
  description: string | null;
  status: CashRegisterStatus;
  createdAt: Date;
  updatedAt: Date;
  branch: { publicId: string; code: string; name: string };
}) {
  return {
    ...register,
    createdAt: register.createdAt.toISOString(),
    updatedAt: register.updatedAt.toISOString(),
  };
}

export async function cashRoutes(app: FastifyInstance): Promise<void> {
  app.get("/cash-registers", { preHandler: requirePermission("cash.register.read") }, async (request) => {
    const auth = request.auth!;
    const registers = await prisma.cashRegister.findMany({
      where: { companyId: auth.companyId, ...accessibleBranchWhere(auth.branchId) },
      select: cashRegisterSelect,
      orderBy: [{ status: "asc" }, { code: "asc" }],
    });
    return { data: registers.map(registerResponse) };
  });

  app.post("/cash-registers", { preHandler: requirePermission("cash.register.create") }, async (request, reply) => {
    const body = cashRegisterCreateSchema.parse(request.body);
    const auth = request.auth!;
    await enforceCompanyLimit(auth.companyId, "cashRegisters");
    const branch = await prisma.branch.findFirst({
      where: {
        publicId: body.branchPublicId,
        companyId: auth.companyId,
        active: true,
        ...(auth.branchId ? { id: auth.branchId } : {}),
      },
    });
    if (!branch) {
      await writeAudit({
        request,
        action: "tenant.access.denied",
        entity: "Branch",
        entityPublicId: body.branchPublicId,
        outcome: AuditOutcome.FAILURE,
        metadata: { operation: "cash.register.create" },
      });
      throw new AppError(400, "BRANCH_INVALID", "A filial informada não está disponível para este usuário.");
    }

    try {
      const register = await prisma.$transaction(async (tx) => {
        const created = await tx.cashRegister.create({
          data: {
            companyId: auth.companyId,
            branchId: branch.id,
            code: body.code.toUpperCase(),
            name: body.name,
            description: body.description || null,
          },
          select: cashRegisterSelect,
        });
        await writeAudit({
          request,
          client: tx,
          action: "cash.register.created",
          entity: "CashRegister",
          entityPublicId: created.publicId,
          branchId: branch.id,
          after: { code: created.code, name: created.name, status: created.status },
        });
        return created;
      });
      return reply.status(201).send({ data: registerResponse(register) });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(409, "CASH_REGISTER_CODE_EXISTS", "Já existe um caixa com este código na filial.");
      }
      throw error;
    }
  });

  app.get<{ Params: { publicId: string } }>(
    "/cash-registers/:publicId",
    { preHandler: requirePermission("cash.register.read") },
    async (request) => {
      const register = await findScopedRegister(request, request.params.publicId);
      return { data: registerResponse(register) };
    },
  );

  app.patch<{ Params: { publicId: string } }>(
    "/cash-registers/:publicId",
    { preHandler: requirePermission("cash.register.update") },
    async (request) => {
      const body = cashRegisterUpdateSchema.parse(request.body);
      const register = await findScopedRegister(request, request.params.publicId);
      try {
        const updated = await prisma.$transaction(async (tx) => {
          const result = await tx.cashRegister.update({
            where: { id: register.id },
            data: {
              ...(body.name === undefined ? {} : { name: body.name }),
              ...(body.code === undefined ? {} : { code: body.code.toUpperCase() }),
              ...(body.description === undefined ? {} : { description: body.description || null }),
            },
            select: cashRegisterSelect,
          });
          await writeAudit({
            request,
            client: tx,
            action: "cash.register.updated",
            entity: "CashRegister",
            entityPublicId: register.publicId,
            branchId: register.branchId,
            before: { code: register.code, name: register.name, description: register.description },
            after: { code: result.code, name: result.name, description: result.description },
          });
          return result;
        });
        return { data: registerResponse(updated) };
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new AppError(409, "CASH_REGISTER_CODE_EXISTS", "Já existe um caixa com este código na filial.");
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { publicId: string } }>(
    "/cash-registers/:publicId/disable",
    { preHandler: requirePermission("cash.register.disable") },
    async (request) => {
      const register = await findScopedRegister(request, request.params.publicId);
      if (register.status === CashRegisterStatus.INACTIVE) return { data: registerResponse(register) };
      const openSession = await prisma.cashSession.findFirst({
        where: { cashRegisterId: register.id, status: CashSessionStatus.OPEN },
        select: { publicId: true },
      });
      if (openSession) throw new AppError(409, "CASH_REGISTER_OPEN_SESSION", "Feche a sessão atual antes de desativar o caixa.");

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.cashRegister.update({
          where: { id: register.id },
          data: { status: CashRegisterStatus.INACTIVE },
          select: cashRegisterSelect,
        });
        await writeAudit({
          request,
          client: tx,
          action: "cash.register.disabled",
          entity: "CashRegister",
          entityPublicId: register.publicId,
          branchId: register.branchId,
          before: { status: register.status },
          after: { status: result.status },
        });
        return result;
      });
      return { data: registerResponse(updated) };
    },
  );

  app.get("/cash-sessions/current", { preHandler: requirePermission("cash.session.read") }, async (request) => {
    const auth = request.auth!;
    const session = await prisma.cashSession.findFirst({
      where: {
        companyId: auth.companyId,
        operatorId: auth.userId,
        status: CashSessionStatus.OPEN,
        ...accessibleBranchWhere(auth.branchId),
      },
      include: cashSessionInclude,
      orderBy: { openedAt: "desc" },
    });
    return { data: session ? await serializeCashSession(session) : null };
  });

  app.post("/cash-sessions/open", { preHandler: requirePermission("cash.session.open") }, async (request, reply) => {
    const body = openCashSessionSchema.parse(request.body);
    const auth = request.auth!;
    const register = await findScopedRegister(request, body.cashRegisterPublicId);
    if (register.status !== CashRegisterStatus.ACTIVE) {
      throw new AppError(409, "CASH_REGISTER_INACTIVE", "Este caixa está inativo e não pode ser aberto.");
    }
    const openingBalance = moneyFromCents(body.openingBalanceInCents);

    try {
      const createdPublicId = await prisma.$transaction(async (tx) => {
        const registerSession = await tx.cashSession.findFirst({
          where: { cashRegisterId: register.id, status: CashSessionStatus.OPEN },
        });
        const operatorSession = await tx.cashSession.findFirst({
          where: { operatorId: auth.userId, status: CashSessionStatus.OPEN },
        });
        if (registerSession) throw new AppError(409, "CASH_REGISTER_ALREADY_OPEN", "Este caixa já possui uma sessão aberta.");
        if (operatorSession) throw new AppError(409, "OPERATOR_ALREADY_HAS_OPEN_SESSION", "O operador já possui uma sessão de caixa aberta.");

        const created = await tx.cashSession.create({
          data: {
            companyId: auth.companyId,
            branchId: register.branchId,
            cashRegisterId: register.id,
            operatorId: auth.userId,
            openingBalance,
            openingNote: body.note || null,
          },
        });
        await tx.cashMovement.create({
          data: {
            companyId: auth.companyId,
            branchId: register.branchId,
            cashSessionId: created.id,
            type: CashMovementType.OPENING_BALANCE,
            direction: CashMovementDirection.CREDIT,
            amount: openingBalance,
            reason: "Abertura de caixa",
            note: body.note || null,
            sourceType: CashMovementSourceType.SYSTEM,
            createdByUserId: auth.userId,
          },
        });
        await writeAudit({
          request,
          client: tx,
          action: "cash.session.opened",
          entity: "CashSession",
          entityPublicId: created.publicId,
          branchId: register.branchId,
          after: {
            cashRegisterPublicId: register.publicId,
            openingBalance: moneyToString(openingBalance),
          },
        });
        return created.publicId;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      const created = await findScopedSession(request, createdPublicId);
      return reply.status(201).send({ data: await serializeCashSession(created) });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(409, "CASH_SESSION_ALREADY_OPEN", "O caixa ou operador já possui uma sessão aberta.");
      }
      throw error;
    }
  });

  app.get("/cash-sessions", { preHandler: requirePermission("cash.session.read") }, async (request) => {
    const query = cashSessionListQuerySchema.parse(request.query);
    const auth = request.auth!;
    const where = {
      companyId: auth.companyId,
      ...accessibleBranchWhere(auth.branchId),
      ...(query.status ? { status: query.status } : {}),
    };
    const sessions = await prisma.cashSession.findMany({
      where,
      include: cashSessionInclude,
      orderBy: { openedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    const total = await prisma.cashSession.count({ where });
    const serializedSessions = [];
    for (const session of sessions) serializedSessions.push(await serializeCashSession(session));
    return {
      data: serializedSessions,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  });

  app.get<{ Params: { publicId: string } }>(
    "/cash-sessions/:publicId",
    { preHandler: requirePermission("cash.session.read") },
    async (request) => ({ data: await serializeCashSession(await findScopedSession(request, request.params.publicId)) }),
  );

  app.get<{ Params: { publicId: string } }>(
    "/cash-sessions/:publicId/movements",
    { preHandler: requirePermission("cash.movement.read") },
    async (request) => {
      const query = paginationSchema.parse(request.query);
      const session = await findScopedSession(request, request.params.publicId);
      const movements = await prisma.cashMovement.findMany({
        where: { cashSessionId: session.id, companyId: request.auth!.companyId },
        include: { createdBy: { select: { publicId: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const total = await prisma.cashMovement.count({
        where: { cashSessionId: session.id, companyId: request.auth!.companyId },
      });
      return {
        data: movements.map((movement) => ({
          publicId: movement.publicId,
          type: movement.type,
          direction: movement.direction,
          amount: moneyToString(movement.amount),
          reason: movement.reason,
          note: movement.note,
          sourceType: movement.sourceType,
          sourceId: movement.sourceId,
          createdAt: movement.createdAt.toISOString(),
          operator: movement.createdBy,
        })),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    },
  );

  const createMovement = (
    type: typeof CashMovementType.SUPPLY | typeof CashMovementType.WITHDRAWAL,
  ) => async (request: FastifyRequest<{ Params: { publicId: string } }>, reply: FastifyReply) => {
    const body = cashMovementCreateSchema.parse(request.body);
    const auth = request.auth!;
    const session = await findScopedSession(request, request.params.publicId);
    if (session.status !== CashSessionStatus.OPEN) {
      await auditClosedMovementAttempt(request, session.publicId);
      throw new AppError(409, "CASH_SESSION_CLOSED", "A sessão está fechada e não aceita movimentações.");
    }
    const amount = moneyFromCents(body.amountInCents);
    const direction = type === CashMovementType.SUPPLY
      ? CashMovementDirection.CREDIT
      : CashMovementDirection.DEBIT;

    const result = await prisma.$transaction(async (tx) => {
      const lockedSession = await tx.cashSession.findFirst({
        where: { id: session.id, companyId: auth.companyId, status: CashSessionStatus.OPEN },
      });
      if (!lockedSession) throw new AppError(409, "CASH_SESSION_CLOSED", "A sessão foi fechada antes da movimentação.");
      const totalsBefore = await getCashTotals(tx, lockedSession.id, lockedSession.openingBalance);
      if (
        type === CashMovementType.WITHDRAWAL &&
        amount.greaterThan(totalsBefore.expectedBalance) &&
        !auth.permissions.has("cash.movement.withdrawal.override")
      ) {
        throw new AppError(422, "WITHDRAWAL_EXCEEDS_BALANCE", "A sangria é superior ao saldo operacional disponível.", {
          availableBalance: moneyToString(totalsBefore.expectedBalance),
        });
      }
      const movement = await tx.cashMovement.create({
        data: {
          companyId: auth.companyId,
          branchId: lockedSession.branchId,
          cashSessionId: lockedSession.id,
          type,
          direction,
          amount,
          reason: body.reason,
          note: body.note || null,
          sourceType: CashMovementSourceType.MANUAL,
          createdByUserId: auth.userId,
        },
      });
      await writeAudit({
        request,
        client: tx,
        action: type === CashMovementType.SUPPLY ? "cash.movement.supplied" : "cash.movement.withdrawn",
        entity: "CashMovement",
        entityPublicId: movement.publicId,
        branchId: lockedSession.branchId,
        after: {
          cashSessionPublicId: lockedSession.publicId,
          type,
          amount: moneyToString(amount),
          reason: body.reason,
        },
      });
      return {
        publicId: movement.publicId,
        type: movement.type,
        direction: movement.direction,
        amount: moneyToString(movement.amount),
        reason: movement.reason,
        note: movement.note,
        sourceType: movement.sourceType,
        sourceId: movement.sourceId,
        createdAt: movement.createdAt.toISOString(),
        operator: { publicId: auth.principal.user.publicId, name: auth.principal.user.name },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const updatedSession = await findScopedSession(request, session.publicId);
    return reply.status(201).send({ data: { movement: result, session: await serializeCashSession(updatedSession) } });
  };

  app.post<{ Params: { publicId: string } }>(
    "/cash-sessions/:publicId/supplies",
    { preHandler: requirePermission("cash.movement.supply") },
    createMovement(CashMovementType.SUPPLY),
  );

  app.post<{ Params: { publicId: string } }>(
    "/cash-sessions/:publicId/withdrawals",
    { preHandler: requirePermission("cash.movement.withdrawal") },
    createMovement(CashMovementType.WITHDRAWAL),
  );

  app.post<{ Params: { publicId: string } }>(
    "/cash-sessions/:publicId/close",
    { preHandler: requirePermission("cash.session.close") },
    async (request) => {
      const body = closeCashSessionSchema.parse(request.body);
      const auth = request.auth!;
      const session = await findScopedSession(request, request.params.publicId);
      if (session.status !== CashSessionStatus.OPEN) {
        throw new AppError(409, "CASH_SESSION_ALREADY_CLOSED", "Esta sessão de caixa já foi fechada.");
      }
      const countedBalance = moneyFromCents(body.countedBalanceInCents);
      const pendingStatuses = [PixChargeStatus.CREATING, PixChargeStatus.WAITING_PAYMENT, PixChargeStatus.PROCESSING, PixChargeStatus.UNDER_REVIEW];
      const pendingChargeCount = await prisma.pixCharge.count({ where: { companyId: auth.companyId, cashSessionId: session.id, status: { in: pendingStatuses } } });
      if (pendingChargeCount > 0 && (!body.allowPendingCharges || !auth.permissions.has("cash.session.close.with_pending_charges"))) {
        await writeAudit({ request, action: "cash.session.close_blocked.pending_charges", entity: "CashSession", entityPublicId: session.publicId, outcome: AuditOutcome.FAILURE, metadata: { pendingChargeCount } });
        throw new AppError(409, "CASH_SESSION_HAS_PENDING_CHARGES", "Existem cobranças Pix pendentes. Aguarde, cancele ou expire as cobranças antes de fechar o caixa.", { pendingChargeCount, canOverride: auth.permissions.has("cash.session.close.with_pending_charges") });
      }

      await prisma.$transaction(async (tx) => {
        const current = await tx.cashSession.findFirst({
          where: { id: session.id, companyId: auth.companyId, status: CashSessionStatus.OPEN },
        });
        if (!current) throw new AppError(409, "CASH_SESSION_ALREADY_CLOSED", "Esta sessão de caixa já foi fechada.");
        const totals = await getCashTotals(tx, current.id, current.openingBalance);
        const discrepancy = countedBalance.minus(totals.expectedBalance);
        await tx.cashSession.update({
          where: { id: current.id },
          data: {
            status: CashSessionStatus.CLOSED,
            expectedBalance: totals.expectedBalance,
            countedBalance,
            discrepancy,
            closingNote: body.note || null,
            closedByUserId: auth.userId,
            closedAt: new Date(),
            closedWithPendingCharges: pendingChargeCount > 0,
          },
        });
        if (pendingChargeCount > 0) {
          await tx.notification.create({ data: { companyId: auth.companyId, branchId: current.branchId, type: NotificationType.CASH_CLOSED_WITH_PENDING_CHARGES, title: "Caixa fechado com Pix pendente", message: "Uma exceção administrativa permitiu o fechamento com cobranças pendentes.", entityType: "CashSession", entityPublicId: current.publicId, metadata: { pendingChargeCount } } });
          await writeAudit({ request, client: tx, action: "cash.session.closed_with_pending_override", entity: "CashSession", entityPublicId: current.publicId, metadata: { pendingChargeCount } });
        }
        await writeAudit({
          request,
          client: tx,
          action: "cash.session.closed",
          entity: "CashSession",
          entityPublicId: current.publicId,
          branchId: current.branchId,
          after: {
            expectedBalance: moneyToString(totals.expectedBalance),
            countedBalance: moneyToString(countedBalance),
            discrepancy: moneyToString(discrepancy),
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { data: await serializeCashSession(await findScopedSession(request, session.publicId)) };
    },
  );
}
