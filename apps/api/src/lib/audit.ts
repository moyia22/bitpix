import { AuditOutcome, prisma, type Prisma } from "@bitpix/database";
import type { FastifyRequest } from "fastify";

interface AuditInput {
  request: FastifyRequest;
  action: string;
  entity: string;
  entityPublicId?: string;
  outcome?: AuditOutcome;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  companyId?: string | null;
  branchId?: string | null;
  userId?: string | null;
  client?: Prisma.TransactionClient;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const auth = input.request.auth;
  const data: Prisma.AuditLogUncheckedCreateInput = {
    companyId: (input.companyId === undefined ? auth?.companyId : input.companyId) ?? null,
    branchId: (input.branchId === undefined ? auth?.branchId : input.branchId) ?? null,
    userId: (input.userId === undefined ? auth?.userId : input.userId) ?? null,
    action: input.action,
    entity: input.entity,
    entityPublicId: input.entityPublicId ?? null,
    outcome: input.outcome ?? AuditOutcome.SUCCESS,
    ipAddress: input.request.ip,
    userAgent: input.request.headers["user-agent"]?.slice(0, 320) ?? null,
    correlationId: input.request.correlationId,
    ...(input.before === undefined ? {} : { before: input.before }),
    ...(input.after === undefined ? {} : { after: input.after }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
  await (input.client ?? prisma).auditLog.create({
    data,
  });
}
