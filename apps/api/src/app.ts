import Fastify, { type FastifyInstance } from "fastify";
import fastifyRawBody from "fastify-raw-body";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { healthRoutes } from "./modules/system/health.routes.js";
import { cashRoutes } from "./modules/cash/cash.routes.js";
import { salesRoutes } from "./modules/sales/sales.routes.js";
import { tenancyRoutes } from "./modules/tenancy/tenancy.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";
import { integrationRoutes } from "./modules/payments/integration.routes.js";
import { pixChargeRoutes } from "./modules/payments/pix-charge.routes.js";
import { webhookRoutes } from "./modules/payments/webhook.routes.js";
import { paymentOperationsRoutes } from "./modules/payments/payment-operations.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { reportRoutes } from "./modules/reports/report.routes.js";
import { roleRoutes } from "./modules/users/role.routes.js";
import { settingsRoutes } from "./modules/settings/settings.routes.js";
import { notificationRoutes } from "./modules/notifications/notification.routes.js";
import { platformRoutes } from "./modules/platform/platform.routes.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerSecurity } from "./plugins/security.js";
import { httpDuration, httpRequests } from "./lib/metrics.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test"
      ? false
      : {
          level: process.env.NODE_ENV === "production" ? "info" : "debug",
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers['set-cookie']",
            "password",
            "token",
          ],
          ...(process.env.NODE_ENV === "development"
            ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } } }
            : {}),
        },
    trustProxy: true,
    requestIdHeader: "x-request-id",
  });

  await registerSecurity(app);
  app.addHook("onRequest", async (request) => { request.metricsStartedAt = process.hrtime.bigint(); });
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unmatched";
    const status = String(reply.statusCode);
    httpRequests.inc({ method: request.method, route, status });
    if (request.metricsStartedAt) httpDuration.observe({ method: request.method, route, status }, Number(process.hrtime.bigint() - request.metricsStartedAt) / 1e9);
  });
  await app.register(fastifyRawBody, { field: "rawBody", global: false, encoding: "utf8", runFirst: true });
  registerErrorHandler(app);
  await app.register(healthRoutes);
  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(cashRoutes);
    await api.register(salesRoutes);
    await api.register(integrationRoutes);
    await api.register(pixChargeRoutes);
    await api.register(webhookRoutes);
    await api.register(paymentOperationsRoutes);
    await api.register(tenancyRoutes);
    await api.register(userRoutes);
    await api.register(auditRoutes);
    await api.register(dashboardRoutes);
    await api.register(reportRoutes);
    await api.register(roleRoutes);
    await api.register(settingsRoutes);
    await api.register(notificationRoutes);
    await api.register(platformRoutes);
  }, { prefix: "/api/v1" });

  return app;
}
