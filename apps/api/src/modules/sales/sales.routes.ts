import { saleDraftSchema } from "@bitpix/contracts";
import { AuditOutcome, CashSessionStatus, prisma } from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { requirePermission } from "../auth/auth.guard.js";
import { moneyFromCents, moneyToString } from "../cash/cash.service.js";

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.post("/sales/prepare", { preHandler: requirePermission("sales.create") }, async (request) => {
    const body = saleDraftSchema.parse(request.body);
    const auth = request.auth!;
    const session = await prisma.cashSession.findFirst({
      where: {
        companyId: auth.companyId,
        operatorId: auth.userId,
        status: CashSessionStatus.OPEN,
        ...(auth.branchId ? { branchId: auth.branchId } : {}),
      },
      include: { cashRegister: { select: { publicId: true, code: true, name: true } } },
      orderBy: { openedAt: "desc" },
    });
    if (!session) {
      await writeAudit({
        request,
        action: "sale.prepare.denied.cash_closed",
        entity: "Sale",
        outcome: AuditOutcome.FAILURE,
        metadata: { reason: "open_cash_session_required" },
      });
      throw new AppError(409, "OPEN_CASH_SESSION_REQUIRED", "Abra o caixa antes de gerar uma cobrança.");
    }

    return {
      data: {
        ready: true,
        persisted: false,
        code: body.code,
        amount: moneyToString(moneyFromCents(body.amountInCents)),
        cashSession: {
          publicId: session.publicId,
          cashRegister: session.cashRegister,
        },
        message: "Caixa validado. A cobrança pode ser gerada pelo fluxo Nova venda.",
      },
    };
  });
}
