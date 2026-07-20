import { roleUpsertSchema } from "@bitpix/contracts";
import { prisma } from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { requireAnyPermission } from "../auth/auth.guard.js";

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/permissions", { preHandler: requireAnyPermission("roles.read", "users.manage") }, async () => ({ data: await prisma.permission.findMany({ where: { key: { not: { startsWith: "platform." } } }, select: { key: true, name: true, description: true }, orderBy: { key: "asc" } }) }));
  app.get("/roles", { preHandler: requireAnyPermission("roles.read", "users.manage") }, async (request) => ({ data: await prisma.role.findMany({ where: { companyId: request.auth!.companyId }, select: { publicId: true, key: true, name: true, active: true, isSystem: true, permissions: { select: { permission: { select: { key: true, name: true } } } }, _count: { select: { users: true } } }, orderBy: { name: "asc" } }) }));

  app.post("/roles", { preHandler: requireAnyPermission("roles.create", "users.manage") }, async (request, reply) => {
    const body = roleUpsertSchema.parse(request.body); const companyId = request.auth!.companyId; rejectPlatformPermissions(body.permissionKeys);
    if (await prisma.role.findUnique({ where: { companyId_key: { companyId, key: body.key } } })) throw new AppError(409, "ROLE_EXISTS", "Já existe uma função com esta chave.");
    const permissions = await prisma.permission.findMany({ where: { key: { in: body.permissionKeys } } });
    if (permissions.length !== new Set(body.permissionKeys).size) throw new AppError(400, "PERMISSION_INVALID", "Uma ou mais permissões são inválidas.");
    const role = await prisma.$transaction(async (tx) => { const created = await tx.role.create({ data: { companyId, key: body.key, name: body.name } }); await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ companyId, roleId: created.id, permissionId: permission.id })) }); await writeAudit({ request, client: tx, action: "role.created", entity: "Role", entityPublicId: created.publicId, after: { key: created.key, name: created.name, permissions: body.permissionKeys } }); return created; });
    return reply.status(201).send({ data: { publicId: role.publicId, key: role.key, name: role.name, active: role.active } });
  });

  app.put<{ Params: { publicId: string } }>("/roles/:publicId", { preHandler: requireAnyPermission("roles.update", "users.manage") }, async (request) => {
    const body = roleUpsertSchema.parse(request.body); const companyId = request.auth!.companyId; rejectPlatformPermissions(body.permissionKeys); const current = await prisma.role.findFirst({ where: { companyId, publicId: request.params.publicId }, include: { permissions: { include: { permission: true } } } });
    if (!current) throw new AppError(404, "ROLE_NOT_FOUND", "Função não encontrada."); if (current.isSystem && body.key !== current.key) throw new AppError(409, "SYSTEM_ROLE_KEY", "A chave de uma função do sistema não pode ser alterada.");
    const conflict = await prisma.role.findFirst({ where: { companyId, key: body.key, id: { not: current.id } } }); if (conflict) throw new AppError(409, "ROLE_EXISTS", "Já existe uma função com esta chave.");
    const permissions = await prisma.permission.findMany({ where: { key: { in: body.permissionKeys } } }); if (permissions.length !== new Set(body.permissionKeys).size) throw new AppError(400, "PERMISSION_INVALID", "Permissão inválida.");
    const role = await prisma.$transaction(async (tx) => { const saved = await tx.role.update({ where: { id: current.id }, data: { key: body.key, name: body.name } }); await tx.rolePermission.deleteMany({ where: { roleId: current.id } }); await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ companyId, roleId: current.id, permissionId: permission.id })) }); await writeAudit({ request, client: tx, action: "role.updated", entity: "Role", entityPublicId: current.publicId, before: { key: current.key, name: current.name, permissions: current.permissions.map((item) => item.permission.key) }, after: { key: body.key, name: body.name, permissions: body.permissionKeys } }); return saved; });
    return { data: { publicId: role.publicId, key: role.key, name: role.name } };
  });

  app.delete<{ Params: { publicId: string } }>("/roles/:publicId", { preHandler: requireAnyPermission("roles.disable", "users.manage") }, async (request) => {
    const role = await prisma.role.findFirst({ where: { companyId: request.auth!.companyId, publicId: request.params.publicId }, include: { _count: { select: { users: true } } } }); if (!role) throw new AppError(404, "ROLE_NOT_FOUND", "Função não encontrada.");
    if (role.isSystem || role._count.users > 0) throw new AppError(409, "ROLE_IN_USE", "Funções do sistema ou atribuídas a usuários não podem ser desativadas."); await prisma.role.update({ where: { id: role.id }, data: { active: false } }); await writeAudit({ request, action: "role.disabled", entity: "Role", entityPublicId: role.publicId, before: { key: role.key, name: role.name, active: role.active }, after: { active: false } }); return { data: { disabled: true } };
  });
}
function rejectPlatformPermissions(keys: readonly string[]): void { if (keys.some((key) => key.startsWith("platform."))) throw new AppError(403, "PLATFORM_PERMISSION_FORBIDDEN", "Permissões da plataforma não podem ser atribuídas por uma empresa."); }
