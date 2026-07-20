import { prisma } from "@bitpix/database";
import { AppError } from "../../lib/errors.js";

export type LimitResource = "users" | "branches" | "cashRegisters" | "monthlyCharges" | "monthlyExports";

export async function companyLimits(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    include: { plan: true, subscription: true },
  });
  const plan = company.plan;
  if (!plan) return { users: 5, branches: 1, cashRegisters: 2, monthlyCharges: 500, monthlyExports: 20 };
  return {
    users: company.subscription?.overrideUserLimit ?? plan.userLimit,
    branches: company.subscription?.overrideBranchLimit ?? plan.branchLimit,
    cashRegisters: company.subscription?.overrideCashLimit ?? plan.cashRegisterLimit,
    monthlyCharges: company.subscription?.overrideChargeLimit ?? plan.monthlyChargeLimit,
    monthlyExports: company.subscription?.overrideExportLimit ?? plan.monthlyExportLimit,
  };
}

export async function enforceCompanyLimit(companyId: string, resource: LimitResource): Promise<void> {
  const limits = await companyLimits(companyId);
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const count = resource === "users" ? await prisma.user.count({ where: { companyId, status: { not: "INACTIVE" } } })
    : resource === "branches" ? await prisma.branch.count({ where: { companyId, active: true } })
      : resource === "cashRegisters" ? await prisma.cashRegister.count({ where: { companyId, status: "ACTIVE" } })
        : resource === "monthlyCharges" ? await prisma.pixCharge.count({ where: { companyId, createdAt: { gte: monthStart } } })
          : await prisma.exportJob.count({ where: { companyId, requestedAt: { gte: monthStart } } });
  if (count >= limits[resource]) throw new AppError(409, "PLAN_LIMIT_REACHED", `O limite do plano para ${resource} foi atingido.`, { resource, limit: limits[resource] });
}
