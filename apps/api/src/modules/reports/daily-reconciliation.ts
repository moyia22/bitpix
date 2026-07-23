import { CompanyStatus, NotificationType, prisma } from "@bitpix/database";
import { analyticsPeriod } from "../dashboard/analytics.service.js";
import { reconciliationRows } from "./report.service.js";

// Job diário: para cada empresa ativa, roda a conciliação financeira do dia
// anterior e, se houver inconsistências, cria UMA notificação (idempotente por
// empresa/dia) para o admin revisar. Reaproveita a mesma lógica do relatório de
// Conciliação — nada de cálculo novo/duplicado.
export async function runDailyReconciliation(): Promise<{ companies: number; alerts: number }> {
  const companies = await prisma.company.findMany({ where: { status: CompanyStatus.ACTIVE }, select: { id: true, timezone: true } });
  let alerts = 0;
  for (const company of companies) {
    try {
      const period = analyticsPeriod({ preset: "yesterday" }, company.timezone);
      const dayKey = period.from.toISOString().slice(0, 10);
      const issues = await reconciliationRows(company.id, period.from, period.to);
      if (issues.length === 0) continue;

      // Idempotência: no máximo uma notificação por empresa por dia conciliado.
      const existing = await prisma.notification.findFirst({ where: { companyId: company.id, entityType: "DailyReconciliation", entityPublicId: dayKey }, select: { id: true } });
      if (existing) continue;

      const high = issues.filter((issue) => issue.severidade === "HIGH").length;
      await prisma.notification.create({
        data: {
          companyId: company.id,
          type: NotificationType.CASH_DISCREPANCY,
          title: "Conciliação diária: inconsistências",
          message: `${issues.length} inconsistência(s) na conciliação de ontem${high ? ` (${high} de alta severidade)` : ""}. Revise em Relatórios › Conciliação.`.slice(0, 300),
          entityType: "DailyReconciliation",
          entityPublicId: dayKey,
          metadata: { total: issues.length, high },
        },
      });
      alerts += 1;
    } catch {
      // Uma empresa com erro não bloqueia a conciliação das demais.
    }
  }
  return { companies: companies.length, alerts };
}
