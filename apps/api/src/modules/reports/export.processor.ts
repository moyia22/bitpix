import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ExportJobStatus, NotificationType, StoredFilePurpose, prisma } from "@bitpix/database";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import XlsxPopulate from "xlsx-populate";
import { reportFilterSchema } from "@bitpix/contracts";
import { reportRows, type ReportRow, type ReportType } from "./report.service.js";
import { getPrivateStorage } from "../../lib/storage.js";

function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function safeCell(value: unknown): string { const text = value == null ? "" : String(value); return /^[=+\-@]/.test(text) ? `'${text}` : text; }
function headers(rows: ReportRow[]): string[] { return rows.length ? Object.keys(rows[0]!) : ["resultado"]; }

async function csv(rows: ReportRow[]): Promise<Buffer> {
  const columns = headers(rows); const quote = (value: unknown) => `"${safeCell(value).replace(/"/g, '""')}"`;
  return Buffer.from(`\uFEFF${columns.map(quote).join(";")}\r\n${rows.map((row) => columns.map((column) => quote(row[column])).join(";")).join("\r\n")}`, "utf8");
}

async function xlsx(rows: ReportRow[]): Promise<Buffer> {
  const workbook = await XlsxPopulate.fromBlankAsync(); const sheet = workbook.sheet(0).name("Relatório"); const columns = headers(rows);
  columns.forEach((column, index) => { sheet.cell(1, index + 1).value(column).style({ bold: true, fill: "EDE9FE", fontColor: "312E81" }); sheet.column(index + 1).width(Math.min(34, Math.max(14, column.length + 4))); });
  rows.forEach((row, rowIndex) => columns.forEach((column, columnIndex) => sheet.cell(rowIndex + 2, columnIndex + 1).value(safeCell(row[column]))));
  return workbook.outputAsync();
}

function pdfSafe(value: unknown): string { return safeCell(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?"); }
async function pdf(rows: ReportRow[], title: string): Promise<Buffer> {
  const document = await PDFDocument.create(); const font = await document.embedFont(StandardFonts.Helvetica); const bold = await document.embedFont(StandardFonts.HelveticaBold); const columns = headers(rows).slice(0, 6); let page = document.addPage([842, 595]); let y = 560;
  const heading = () => { page.drawText(pdfSafe(title), { x: 32, y, size: 16, font: bold, color: rgb(0.27, 0.22, 0.75) }); y -= 26; page.drawText(columns.map((column) => pdfSafe(column).slice(0, 18).padEnd(19)).join(""), { x: 32, y, size: 8, font: bold }); y -= 14; };
  heading();
  for (const row of rows) { if (y < 35) { page = document.addPage([842, 595]); y = 560; heading(); } const line = columns.map((column) => pdfSafe(row[column]).slice(0, 18).padEnd(19)).join(""); page.drawText(line, { x: 32, y, size: 7.5, font }); y -= 12; }
  return Buffer.from(await document.save());
}

export async function processExportJob(publicId: string): Promise<void> {
  const job = await prisma.exportJob.findUnique({ where: { publicId } }); if (!job || job.status === ExportJobStatus.COMPLETED) return;
  await prisma.exportJob.update({ where: { id: job.id }, data: { status: ExportJobStatus.PROCESSING, progress: 10, startedAt: new Date() } });
  try {
    const parsed = reportFilterSchema.parse({ ...(job.filters as Record<string, unknown>), page: 1, pageSize: 50 });
    const result = await reportRows(job.companyId, job.reportType as ReportType, parsed, 10_000); const data = job.format === "CSV" ? await csv(result.rows) : job.format === "XLSX" ? await xlsx(result.rows) : await pdf(result.rows, `BitPix - ${job.reportType}`);
    const extension = job.format.toLowerCase(); const storageKey = `exports/${job.companyId}/${randomUUID()}.${extension}`;
    const mimeType = job.format === "CSV" ? "text/csv; charset=utf-8" : job.format === "XLSX" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
    await getPrivateStorage().put(storageKey, data, mimeType);
    await prisma.$transaction(async (tx) => {
      const stored = await tx.storedFile.create({ data: { companyId: job.companyId, purpose: StoredFilePurpose.REPORT_EXPORT, storageKey, originalName: `bitpix-${job.reportType.toLowerCase()}.${extension}`, mimeType, sizeBytes: data.length, sha256: hash(data), expiresAt: job.expiresAt } });
      await tx.exportJob.update({ where: { id: job.id }, data: { status: ExportJobStatus.COMPLETED, progress: 100, rowCount: result.total, outputFileId: stored.id, completedAt: new Date() } });
      await tx.notification.create({ data: { companyId: job.companyId, type: NotificationType.EXPORT_COMPLETED, title: "Exportação concluída", message: `O relatório ${job.reportType} está pronto para download.`, entityType: "ExportJob", entityPublicId: job.publicId } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "Falha ao gerar exportação";
    await prisma.$transaction([prisma.exportJob.update({ where: { id: job.id }, data: { status: ExportJobStatus.FAILED, errorMessage: message } }), prisma.notification.create({ data: { companyId: job.companyId, type: NotificationType.EXPORT_FAILED, title: "Exportação não concluída", message: "Não foi possível gerar o arquivo solicitado.", entityType: "ExportJob", entityPublicId: job.publicId } })]);
    throw error;
  }
}

export async function issueDownloadToken(fileId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url"); const expiresAt = new Date(Date.now() + 10 * 60_000);
  await prisma.storedFile.update({ where: { id: fileId }, data: { downloadTokenHash: hash(token), downloadExpiresAt: expiresAt } }); return { token, expiresAt };
}

export function tokenHash(token: string): string { return hash(token); }
