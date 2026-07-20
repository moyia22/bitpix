import { Queue } from "bullmq";
import type Redis from "ioredis";
import { env } from "../../config/env.js";
import { getRedis } from "../../lib/redis.js";
import { MercadoPagoWebhookProcessor } from "./mercado-pago-webhook-processor.js";
import { incrementPaymentMetric } from "./payment-metrics.js";

export const mercadoPagoWebhookQueueName = "mercado-pago-webhooks";
let queue: Queue | undefined;
let queueConnection: Redis | undefined;

export interface SafeWebhookJob {
  webhookEventPublicId: string;
  companyId: string;
  correlationId: string;
  attempt: number;
}

export async function enqueueWebhook(input: SafeWebhookJob): Promise<"queue" | "fallback" | "unavailable"> {
  const base = getRedis();
  if (base.status === "wait") {
    try { await base.connect(); } catch { /* readiness continuará degradado */ }
  }
  if (base.status === "ready") {
    if (!queue) {
      queueConnection = base.duplicate({ maxRetriesPerRequest: null });
      queue = new Queue(mercadoPagoWebhookQueueName, { connection: queueConnection });
    }
    await queue.add("mercado-pago.webhook.received", input, {
      jobId: input.webhookEventPublicId,
      attempts: env.WEBHOOK_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 2_000 },
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 5_000 },
    });
    incrementPaymentMetric("webhooks_queued_total");
    return "queue";
  }
  if (env.APP_ENV === "development" && env.WEBHOOK_LOCAL_FALLBACK) {
    incrementPaymentMetric("webhook_local_fallback_total");
    setImmediate(() => {
      void new MercadoPagoWebhookProcessor().processWebhook(input.webhookEventPublicId, input.attempt).catch(() => undefined);
    });
    return "fallback";
  }
  return "unavailable";
}

export async function webhookQueueCounts(): Promise<Record<string, number> | null> {
  if (!queue) return null;
  return queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
}
