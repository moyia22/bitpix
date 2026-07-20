import { Queue } from "bullmq";
import type Redis from "ioredis";
import { env } from "../../config/env.js";
import { getRedis } from "../../lib/redis.js";
import { processExportJob } from "./export.processor.js";

export const exportQueueName = "report-exports"; let queue: Queue | undefined; let connection: Redis | undefined;
export async function enqueueExport(publicId: string): Promise<"queue" | "fallback" | "unavailable"> {
  const redis = getRedis(); if (redis.status === "wait") { try { await redis.connect(); } catch { /* readiness permanece degradado */ } }
  if (redis.status === "ready") { connection ??= redis.duplicate({ maxRetriesPerRequest: null }); queue ??= new Queue(exportQueueName, { connection }); await queue.add("report.export", { exportJobPublicId: publicId }, { jobId: publicId, attempts: 3, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: { age: 86_400, count: 2_000 }, removeOnFail: { age: 1_209_600, count: 5_000 } }); return "queue"; }
  if (env.APP_ENV === "development" && env.WEBHOOK_LOCAL_FALLBACK) { setImmediate(() => void processExportJob(publicId).catch(() => undefined)); return "fallback"; }
  return "unavailable";
}
export async function queueHealth(): Promise<Record<string, number> | null> { return queue ? queue.getJobCounts("waiting", "active", "delayed", "failed", "completed") : null; }
