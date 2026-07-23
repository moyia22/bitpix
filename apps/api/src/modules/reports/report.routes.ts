import { exportRequestSchema, reportFilterSchema, type PermissionKey } from "@bitpix/contracts";
import { ExportJobStatus, prisma } from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { requirePermission } from "../auth/auth.guard.js";
import { enforceCompanyLimit } from "../platform/plan-limits.js";
import { enqueueExport } from "./export-queue.js";
import { issueDownloadToken, tokenHash } from "./export.processor.js";
import { getPrivateStorage } from "../../lib/storage.js";
import { reportRows, type ReportType } from "./report.service.js";

const endpoints: Array<{ path: string; type: ReportType; permission: PermissionKey }> = [
  { path: "/reports/sales", type: "SALES", permission: "reports.sales.read" },
  { path: "/reports/payments", type: "PAYMENTS", permission: "reports.payments.read" },
  { path: "/reports/charges", type: "CHARGES", permission: "reports.sales.read" },
  { path: "/reports/cash-sessions", type: "CASH_SESSIONS", permission: "reports.cash.read" },
  { path: "/reports/cash-movements", type: "CASH_MOVEMENTS", permission: "reports.cash.read" },
  { path: "/reports/reconciliation", type: "RECONCILIATION", permission: "reports.reconciliation.read" },
  { path: "/reports/closing", type: "CLOSING", permission: "reports.cash.read" },
];

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  for (const endpoint of endpoints) app.get(endpoint.path, { preHandler: requirePermission(endpoint.permission), config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    const filters = reportFilterSchema.parse(request.query); const result = await reportRows(request.auth!.companyId, endpoint.type, filters);
    return { data: result.rows, pagination: { page: filters.page, pageSize: filters.pageSize, total: result.total, totalPages: Math.ceil(result.total / filters.pageSize) }, meta: { timezone: result.timezone } };
  });

  app.post("/reports/exports", { preHandler: requirePermission("reports.export"), config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = exportRequestSchema.parse(request.body); await enforceCompanyLimit(request.auth!.companyId, "monthlyExports");
    const job = await prisma.exportJob.create({ data: { companyId: request.auth!.companyId, requestedById: request.auth!.userId, reportType: body.reportType, format: body.format, filters: body.filters, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
    const mode = await enqueueExport(job.publicId);
    if (mode === "unavailable") { await prisma.exportJob.update({ where: { id: job.id }, data: { status: ExportJobStatus.FAILED, errorMessage: "Fila de exportação indisponível" } }); throw new AppError(503, "EXPORT_QUEUE_UNAVAILABLE", "A fila de exportação está indisponível."); }
    await writeAudit({ request, action: "report.export.requested", entity: "ExportJob", entityPublicId: job.publicId, metadata: { reportType: body.reportType, format: body.format, mode } });
    return reply.status(202).send({ data: { publicId: job.publicId, status: job.status, mode } });
  });

  app.get<{ Params: { publicId: string } }>("/reports/exports/:publicId", { preHandler: requirePermission("reports.export") }, async (request) => {
    const job = await prisma.exportJob.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId }, include: { outputFile: true } }); if (!job) throw new AppError(404, "EXPORT_NOT_FOUND", "Exportação não encontrada.");
    const download = job.status === "COMPLETED" && job.outputFile ? await issueDownloadToken(job.outputFile.id) : null;
    return { data: { publicId: job.publicId, reportType: job.reportType, format: job.format, status: job.status, progress: job.progress, rowCount: job.rowCount, errorMessage: job.errorMessage, requestedAt: job.requestedAt.toISOString(), completedAt: job.completedAt?.toISOString() ?? null, expiresAt: job.expiresAt.toISOString(), downloadUrl: download ? `/api/v1/reports/exports/${job.publicId}/download?token=${encodeURIComponent(download.token)}` : null, downloadExpiresAt: download?.expiresAt.toISOString() ?? null } };
  });

  app.get<{ Params: { publicId: string }; Querystring: { token?: string } }>("/reports/exports/:publicId/download", { preHandler: requirePermission("reports.export") }, async (request, reply) => {
    const job = await prisma.exportJob.findFirst({ where: { publicId: request.params.publicId, companyId: request.auth!.companyId, status: "COMPLETED" }, include: { outputFile: true } }); const token = request.query.token;
    if (!job?.outputFile || !token || !job.outputFile.downloadTokenHash || job.outputFile.downloadExpiresAt! < new Date() || tokenHash(token) !== job.outputFile.downloadTokenHash) throw new AppError(403, "DOWNLOAD_TOKEN_INVALID", "O link de download expirou ou é inválido.");
    const data = await getPrivateStorage().get(job.outputFile.storageKey); await writeAudit({ request, action: "report.export.downloaded", entity: "ExportJob", entityPublicId: job.publicId, metadata: { format: job.format } });
    return reply.header("content-type", job.outputFile.mimeType).header("content-disposition", `attachment; filename="${job.outputFile.originalName ?? "bitpix-export"}"`).header("cache-control", "private, no-store").send(data);
  });
}
