import { analyticsFilterSchema } from "@bitpix/contracts";
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../auth/auth.guard.js";
import { dashboardSummary } from "./analytics.service.js";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard/summary", { preHandler: requirePermission("dashboard.read") }, async (request) => ({ data: await dashboardSummary(request.auth!.companyId, analyticsFilterSchema.parse(request.query)) }));
  app.get("/dashboard/revenue", { preHandler: requirePermission("dashboard.financial.read") }, async (request) => { const data = await dashboardSummary(request.auth!.companyId, analyticsFilterSchema.parse(request.query)); return { data: { period: data.period, primary: data.primary, revenueByDay: data.charts.revenueByDay, revenueByHour: data.charts.revenueByHour } }; });
  app.get("/dashboard/status-distribution", { preHandler: requirePermission("dashboard.read") }, async (request) => { const data = await dashboardSummary(request.auth!.companyId, analyticsFilterSchema.parse(request.query)); return { data: data.charts.statusDistribution }; });
  app.get("/dashboard/operators", { preHandler: requirePermission("dashboard.operator.read") }, async (request) => { const data = await dashboardSummary(request.auth!.companyId, analyticsFilterSchema.parse(request.query)); return { data: data.charts.operators }; });
  app.get("/dashboard/branches", { preHandler: requirePermission("dashboard.read") }, async (request) => { const data = await dashboardSummary(request.auth!.companyId, analyticsFilterSchema.parse(request.query)); return { data: data.charts.branches }; });
  app.get("/dashboard/recent-payments", { preHandler: requirePermission("dashboard.read") }, async (request) => { const data = await dashboardSummary(request.auth!.companyId, analyticsFilterSchema.parse(request.query)); return { data: data.recentPayments }; });
}
