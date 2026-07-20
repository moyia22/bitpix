import { paginationSchema } from "@bitpix/contracts";
import { prisma } from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { requirePermission } from "../auth/auth.guard.js";

const querySchema = paginationSchema.extend({ status: z.enum(["OPEN", "READ", "RESOLVED"]).optional() });
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notifications", { preHandler: requirePermission("notifications.read") }, async (request) => { const query = querySchema.parse(request.query); const where = { companyId: request.auth!.companyId, ...(query.status ? { status: query.status } : {}) }; const [data, total, unread] = await Promise.all([prisma.notification.findMany({ where, select: { publicId: true, type: true, status: true, title: true, message: true, entityType: true, entityPublicId: true, metadata: true, createdAt: true, readAt: true, resolvedAt: true, branch: { select: { publicId: true, name: true } } }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), prisma.notification.count({ where }), prisma.notification.count({ where: { companyId: request.auth!.companyId, status: "OPEN" } })]); return { data, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) }, meta: { unread } }; });
  app.post<{ Params: { publicId: string } }>("/notifications/:publicId/read", { preHandler: requirePermission("notifications.update") }, async (request) => update(request.auth!.companyId, request.params.publicId, "READ"));
  app.post<{ Params: { publicId: string } }>("/notifications/:publicId/resolve", { preHandler: requirePermission("notifications.update") }, async (request) => update(request.auth!.companyId, request.params.publicId, "RESOLVED"));
  app.post("/notifications/read-all", { preHandler: requirePermission("notifications.update") }, async (request) => { const result = await prisma.notification.updateMany({ where: { companyId: request.auth!.companyId, status: "OPEN" }, data: { status: "READ", readAt: new Date() } }); return { data: { updated: result.count } }; });
}
async function update(companyId: string, publicId: string, status: "READ" | "RESOLVED") { const item = await prisma.notification.findFirst({ where: { companyId, publicId } }); if (!item) throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notificação não encontrada."); const data = await prisma.notification.update({ where: { id: item.id }, data: status === "READ" ? { status, readAt: new Date() } : { status, readAt: item.readAt ?? new Date(), resolvedAt: new Date() } }); return { data }; }
