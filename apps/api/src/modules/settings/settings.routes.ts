import { createHash, randomUUID } from "node:crypto";
import { companySettingsSchema, logoUploadSchema, printTemplateSchema } from "@bitpix/contracts";
import { Prisma, prisma } from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { authenticate, requirePermission } from "../auth/auth.guard.js";
import { getPrivateStorage } from "../../lib/storage.js";
import { isValidPayerEmail } from "../payments/payer-email.js";

const preferenceSchema = z.object({ theme: z.enum(["LIGHT", "DARK", "SYSTEM"]).optional(), paymentSoundEnabled: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0);
const printSelect = { publicId: true, scopeKey: true, storeName: true, title: true, messageAboveQr: true, messageBelowQr: true, footer: true, paperWidth: true, qrSize: true, alignment: true, showSaleCode: true, showAmount: true, showPixCopyPaste: true, showDate: true, showTime: true, showExpiration: true, showOperator: true, showCashRegister: true, showTransactionId: true, showNonFiscalDisclaimer: true, copies: true, cutSpacingMm: true, autoPrint: true, printAfterConfirmation: true, autoReturnToSale: true, paymentSoundEnabled: true, logoFile: { select: { publicId: true, originalName: true, mimeType: true } } } as const;

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/settings", { preHandler: requirePermission("settings.read") }, async (request) => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: request.auth!.companyId }, include: { setting: true } });
    const setting = company.setting ?? await prisma.companySetting.create({ data: { companyId: company.id } });
    return { data: { displayName: company.displayName, timezone: company.timezone, defaultPixExpirationMinutes: setting.defaultPixExpirationMinutes, confirmBeforePix: setting.confirmBeforePix, blockDuplicateCode: setting.blockDuplicateCode, autoPrint: setting.autoPrint, printAfterConfirmation: setting.printAfterConfirmation, autoReturnToSale: setting.autoReturnToSale, autoReturnSeconds: setting.autoReturnSeconds, blockCloseWithPendingCharges: setting.blockCloseWithPendingCharges, minSaleAmountInCents: setting.minSaleAmount.times(100).toNumber(), maxSaleAmountInCents: setting.maxSaleAmount.times(100).toNumber(), pixPayerEmail: setting.pixPayerEmail ?? "", quickItems: setting.quickItems ?? [], paymentSoundEnabled: true } };
  });
  app.put("/settings", { preHandler: requirePermission("settings.update") }, async (request) => {
    const body = companySettingsSchema.parse(request.body); const companyId = request.auth!.companyId;
    // Valida o e-mail Pix da empresa antes de salvar: "" limpa; não-vazio deve ser
    // um e-mail com domínio real (recusa .local e afins).
    let pixPayerEmail: string | null | undefined;
    if (body.pixPayerEmail !== undefined) {
      const trimmed = body.pixPayerEmail.trim();
      if (trimmed === "") pixPayerEmail = null;
      else if (isValidPayerEmail(trimmed)) pixPayerEmail = trimmed.toLowerCase();
      else throw new AppError(400, "PIX_PAYER_EMAIL_INVALID", "E-mail Pix da empresa inválido. Use um e-mail com domínio real (não .local).");
    }
    await prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id: companyId }, data: { displayName: body.displayName, timezone: body.timezone } });
      const setting = { defaultPixExpirationMinutes: body.defaultPixExpirationMinutes, confirmBeforePix: body.confirmBeforePix, blockDuplicateCode: body.blockDuplicateCode, autoPrint: body.autoPrint, printAfterConfirmation: body.printAfterConfirmation, autoReturnToSale: body.autoReturnToSale, autoReturnSeconds: body.autoReturnSeconds, blockCloseWithPendingCharges: body.blockCloseWithPendingCharges, minSaleAmount: new Prisma.Decimal(body.minSaleAmountInCents).div(100), maxSaleAmount: new Prisma.Decimal(body.maxSaleAmountInCents).div(100), ...(pixPayerEmail !== undefined ? { pixPayerEmail } : {}), ...(body.quickItems !== undefined ? { quickItems: body.quickItems as Prisma.InputJsonValue } : {}) };
      await tx.companySetting.upsert({ where: { companyId }, create: { companyId, ...setting }, update: setting });
      await tx.userPreference.upsert({ where: { userId: request.auth!.userId }, create: { userId: request.auth!.userId, paymentSoundEnabled: body.paymentSoundEnabled }, update: { paymentSoundEnabled: body.paymentSoundEnabled } });
    });
    await writeAudit({ request, action: "settings.updated", entity: "CompanySetting", after: body }); return { data: { updated: true } };
  });
  app.get("/settings/effective", { preHandler: authenticate }, async (request) => {
    const [company, branch, preference] = await Promise.all([prisma.company.findUniqueOrThrow({ where: { id: request.auth!.companyId }, include: { setting: true } }), request.auth!.branchId ? prisma.branch.findUnique({ where: { id: request.auth!.branchId }, include: { setting: true } }) : null, prisma.userPreference.findUnique({ where: { userId: request.auth!.userId } })]); const c = company.setting; const b = branch?.setting;
    return { data: { timezone: branch?.timezone ?? company.timezone, defaultPixExpirationMinutes: b?.defaultPixExpirationMinutes ?? c?.defaultPixExpirationMinutes ?? 30, autoPrint: b?.autoPrint ?? c?.autoPrint ?? false, printAfterConfirmation: b?.printAfterConfirmation ?? c?.printAfterConfirmation ?? false, autoReturnToSale: b?.autoReturnToSale ?? c?.autoReturnToSale ?? false, autoReturnSeconds: b?.autoReturnSeconds ?? c?.autoReturnSeconds ?? 5, blockCloseWithPendingCharges: b?.blockCloseWithPendingCharges ?? c?.blockCloseWithPendingCharges ?? true, minSaleAmount: (b?.minSaleAmount ?? c?.minSaleAmount ?? new Prisma.Decimal("0.01")).toFixed(2), maxSaleAmount: (b?.maxSaleAmount ?? c?.maxSaleAmount ?? new Prisma.Decimal("999999999.99")).toFixed(2), theme: preference?.theme ?? "SYSTEM", paymentSoundEnabled: preference?.paymentSoundEnabled ?? true, quickItems: c?.quickItems ?? [], precedence: ["platform", "company", ...(branch ? ["branch"] : []), "user"] } };
  });
  app.patch("/preferences", { preHandler: authenticate }, async (request) => {
    const body = preferenceSchema.parse(request.body); const values = { ...(body.theme ? { theme: body.theme } : {}), ...(body.paymentSoundEnabled === undefined ? {} : { paymentSoundEnabled: body.paymentSoundEnabled }) }; const value = await prisma.userPreference.upsert({ where: { userId: request.auth!.userId }, create: { userId: request.auth!.userId, ...values }, update: values }); return { data: { theme: value.theme, paymentSoundEnabled: value.paymentSoundEnabled } };
  });
  app.get("/print-template", { preHandler: requirePermission("print.settings.read") }, async (request) => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: request.auth!.companyId } }); const template = await prisma.printTemplate.upsert({ where: { companyId_scopeKey: { companyId: company.id, scopeKey: "COMPANY_DEFAULT" } }, create: { companyId: company.id, scopeKey: "COMPANY_DEFAULT", storeName: company.displayName }, update: {}, select: printSelect }); return { data: template };
  });
  app.put("/print-template", { preHandler: requirePermission("print.settings.update") }, async (request) => {
    const body = printTemplateSchema.parse(request.body); const companyId = request.auth!.companyId;
    const values = { storeName: body.storeName, title: body.title, ...(body.messageAboveQr === undefined ? {} : { messageAboveQr: body.messageAboveQr }), ...(body.messageBelowQr === undefined ? {} : { messageBelowQr: body.messageBelowQr }), ...(body.footer === undefined ? {} : { footer: body.footer }), paperWidth: body.paperWidth, qrSize: body.qrSize, alignment: body.alignment, showSaleCode: body.showSaleCode, showAmount: body.showAmount, showPixCopyPaste: body.showPixCopyPaste, showDate: body.showDate, showTime: body.showTime, showExpiration: body.showExpiration, showOperator: body.showOperator, showCashRegister: body.showCashRegister, showTransactionId: body.showTransactionId, showNonFiscalDisclaimer: body.showNonFiscalDisclaimer, copies: body.copies, cutSpacingMm: body.cutSpacingMm, autoPrint: body.autoPrint, printAfterConfirmation: body.printAfterConfirmation, autoReturnToSale: body.autoReturnToSale, paymentSoundEnabled: body.paymentSoundEnabled };
    const template = await prisma.printTemplate.upsert({ where: { companyId_scopeKey: { companyId, scopeKey: "COMPANY_DEFAULT" } }, create: { companyId, scopeKey: "COMPANY_DEFAULT", ...values }, update: values, select: printSelect }); await writeAudit({ request, action: "print.template.updated", entity: "PrintTemplate", entityPublicId: template.publicId, after: template }); return { data: template };
  });
  app.post("/print-template/logo", { preHandler: requirePermission("print.settings.update"), config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = logoUploadSchema.parse(request.body); const bytes = Buffer.from(body.base64.replace(/^data:[^;]+;base64,/, ""), "base64"); if (!bytes.length || bytes.length > 2_000_000 || !validImage(bytes, body.mimeType)) throw new AppError(400, "LOGO_INVALID", "A imagem é inválida ou excede 2 MB."); const extension = body.mimeType === "image/png" ? "png" : body.mimeType === "image/jpeg" ? "jpg" : "webp"; const storageKey = `logos/${request.auth!.companyId}/${randomUUID()}.${extension}`; await getPrivateStorage().put(storageKey, bytes, body.mimeType); const sha256 = createHash("sha256").update(bytes).digest("hex"); const file = await prisma.$transaction(async (tx) => { const stored = await tx.storedFile.create({ data: { companyId: request.auth!.companyId, purpose: "COMPANY_LOGO", storageKey, originalName: body.fileName, mimeType: body.mimeType, sizeBytes: bytes.length, sha256 } }); await tx.printTemplate.update({ where: { companyId_scopeKey: { companyId: request.auth!.companyId, scopeKey: "COMPANY_DEFAULT" } }, data: { logoFileId: stored.id } }); return stored; }); await writeAudit({ request, action: "print.logo.updated", entity: "StoredFile", entityPublicId: file.publicId, metadata: { mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256 } }); return reply.status(201).send({ data: { publicId: file.publicId, fileName: file.originalName, mimeType: file.mimeType } });
  });
}
function validImage(bytes: Buffer, mime: string): boolean { if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9; return mime === "image/webp" && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"; }
