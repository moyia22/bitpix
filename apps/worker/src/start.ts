import { resolve } from "node:path";
import { Queue, Worker } from "bullmq";
import { config } from "dotenv";
import Redis from "ioredis";

config({ path: resolve(process.cwd(), "../../.env") });
const [{ prisma }, { MercadoPagoWebhookProcessor }, { processExportJob }] = await Promise.all([
  import("@bitpix/database"),
  import("@bitpix/api/webhook-processor"),
  import("@bitpix/api/export-processor"),
]);

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL não configurada");

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queueConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
connection.on("error", (error) => console.error(JSON.stringify({ level: "error", component: "worker", dependency: "redis", message: error.message })));
queueConnection.on("error", (error) => console.error(JSON.stringify({ level: "error", component: "worker-queue", dependency: "redis", message: error.message })));

const maintenanceQueue = new Queue("bitpix-maintenance", { connection: queueConnection });
await maintenanceQueue.upsertJobScheduler(
  "expired-session-pruning",
  { every: 60 * 60 * 1000 },
  { name: "sessions.prune", data: {} },
);

const maintenanceWorker = new Worker(
  "bitpix-maintenance",
  async (job) => {
    if (job.name !== "sessions.prune") throw new Error(`Tipo de trabalho não suportado: ${job.name}`);
    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await prisma.userSession.deleteMany({ where: { OR: [{ expiresAt: { lt: threshold } }, { revokedAt: { lt: threshold } }] } });
    return { deletedSessions: result.count };
  },
  { connection, concurrency: 2 },
);

const webhookConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
webhookConnection.on("error", (error) => console.error(JSON.stringify({ level: "error", component: "webhook-worker", dependency: "redis", message: error.message })));
const webhookProcessor = new MercadoPagoWebhookProcessor();
const webhookQueue = new Queue("mercado-pago-webhooks", { connection: queueConnection });
const webhookWorker = new Worker(
  "mercado-pago-webhooks",
  async (job) => {
    if (job.name !== "mercado-pago.webhook.received") throw new Error(`Tipo de webhook não suportado: ${job.name}`);
    const webhookEventPublicId = String(job.data.webhookEventPublicId ?? "");
    if (!webhookEventPublicId) throw new Error("Job sem webhookEventPublicId");
    return webhookProcessor.processWebhook(webhookEventPublicId, job.attemptsMade + 1);
  },
  { connection: webhookConnection, concurrency: 4, lockDuration: 30_000 },
);

const exportConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
exportConnection.on("error", (error) => console.error(JSON.stringify({ level: "error", component: "export-worker", dependency: "redis", message: error.message })));
const exportQueue = new Queue("report-exports", { connection: queueConnection });
const exportWorker = new Worker("report-exports", async (job) => {
  if (job.name !== "report.export") throw new Error(`Tipo de exportação não suportado: ${job.name}`);
  const publicId = String(job.data.exportJobPublicId ?? ""); if (!publicId) throw new Error("Job sem exportJobPublicId"); await processExportJob(publicId); return { publicId };
}, { connection: exportConnection, concurrency: 2, lockDuration: 60_000 });

maintenanceWorker.on("completed", (job) => console.info(JSON.stringify({ level: "info", component: "worker", job: job.name, status: "completed" })));
maintenanceWorker.on("failed", (job, error) => console.error(JSON.stringify({ level: "error", component: "worker", job: job?.name ?? "unknown", message: error.message })));
webhookWorker.on("completed", (job) => console.info(JSON.stringify({ level: "info", component: "webhook-worker", jobId: job.id, status: "completed", attemptsMade: job.attemptsMade })));
webhookWorker.on("failed", (job, error) => console.error(JSON.stringify({ level: "error", component: "webhook-worker", jobId: job?.id ?? "unknown", message: error.message, attemptsMade: job?.attemptsMade ?? 0 })));
exportWorker.on("completed", (job) => console.info(JSON.stringify({ level: "info", component: "export-worker", jobId: job.id, status: "completed" })));
exportWorker.on("failed", (job, error) => console.error(JSON.stringify({ level: "error", component: "export-worker", jobId: job?.id ?? "unknown", message: error.message })));

const heartbeat = async (): Promise<void> => {
  const counts = await webhookQueue.getJobCounts("waiting", "active", "delayed", "failed");
  const exportCounts = await exportQueue.getJobCounts("waiting", "active", "delayed", "failed");
  await connection.multi()
    .set("bitpix:worker:heartbeat", new Date().toISOString(), "EX", 30)
    .set("bitpix:worker:webhook-counts", JSON.stringify(counts), "EX", 30)
    .set("bitpix:worker:export-counts", JSON.stringify(exportCounts), "EX", 30)
    .exec();
};
await heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), 10_000);

const shutdown = async (): Promise<void> => {
  clearInterval(heartbeatTimer);
  await maintenanceWorker.close();
  await webhookWorker.close();
  await exportWorker.close();
  await maintenanceQueue.close();
  await webhookQueue.close();
  await exportQueue.close();
  await connection.quit();
  await queueConnection.quit();
  await webhookConnection.quit();
  await exportConnection.quit();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

console.info(JSON.stringify({ level: "info", component: "worker", status: "ready", queues: ["bitpix-maintenance", "mercado-pago-webhooks", "report-exports"] }));
