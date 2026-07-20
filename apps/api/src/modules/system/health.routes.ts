import { PixChargeStatus, prisma } from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { getRedis } from "../../lib/redis.js";
import { paymentMetricsSnapshot } from "../payments/payment-metrics.js";
import { webhookQueueCounts } from "../payments/webhook-queue.js";
import { dependencyHealth, metricsRegistry, oldPendingCharges } from "../../lib/metrics.js";
import { getPrivateStorage } from "../../lib/storage.js";
import { env } from "../../config/env.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", async () => ({
    status: "ok",
    service: "bitpix-api",
    timestamp: new Date().toISOString(),
  }));

  app.get("/health/ready", async (_request, reply) => {
    const checks = { database: false, redis: false, worker: false, queue: false, storage: false };
    let queueCounts: Record<string, number> | null = null;

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      checks.database = false;
    }

    try {
      const redis = getRedis();
      if (redis.status === "wait") await redis.connect();
      checks.redis = (await redis.ping()) === "PONG";
      const heartbeat = await redis.get("bitpix:worker:heartbeat");
      checks.worker = Boolean(heartbeat && Date.now() - Date.parse(heartbeat) < 30_000);
      queueCounts = await webhookQueueCounts();
      const heartbeatCounts = await redis.get("bitpix:worker:webhook-counts");
      if (!queueCounts && heartbeatCounts) queueCounts = JSON.parse(heartbeatCounts) as Record<string, number>;
      checks.queue = queueCounts !== null && (queueCounts.failed ?? 0) < 100;
    } catch {
      checks.redis = false;
    }

    try { checks.storage = await getPrivateStorage().healthy(); } catch { checks.storage = false; }
    for (const [dependency, healthy] of Object.entries(checks)) dependencyHealth.set({ dependency }, healthy ? 1 : 0);

    const ready = Object.values(checks).every(Boolean);
    return reply.status(ready ? 200 : 503).send({
      status: ready ? "ready" : "degraded",
      checks,
      queue: queueCounts,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/health/metrics.json", async () => {
    const pendingChargesOld = await prisma.pixCharge.count({ where: { status: { in: [PixChargeStatus.CREATING, PixChargeStatus.WAITING_PAYMENT, PixChargeStatus.PROCESSING, PixChargeStatus.UNDER_REVIEW] }, createdAt: { lt: new Date(Date.now() - 15 * 60_000) } } });
    return { data: { ...paymentMetricsSnapshot(), gauges: { pending_charges_old: pendingChargesOld } }, timestamp: new Date().toISOString() };
  });

  app.get("/health/metrics", async (_request, reply) => {
    const pendingChargesOld = await prisma.pixCharge.count({ where: { status: { in: [PixChargeStatus.CREATING, PixChargeStatus.WAITING_PAYMENT, PixChargeStatus.PROCESSING, PixChargeStatus.UNDER_REVIEW] }, createdAt: { lt: new Date(Date.now() - 15 * 60_000) } } });
    oldPendingCharges.set(pendingChargesOld);
    return reply.type(metricsRegistry.contentType).send(await metricsRegistry.metrics());
  });

  app.get("/health/version", async () => ({
    service: "bitpix-api",
    version: env.APP_VERSION,
    commit: env.APP_COMMIT_SHA,
    builtAt: env.APP_BUILD_DATE,
    environment: env.APP_ENV,
  }));
}
