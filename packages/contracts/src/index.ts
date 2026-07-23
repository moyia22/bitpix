import { z } from "zod";

export const permissionKeys = [
  "sales.create",
  "sales.read",
  "pix.charge.create",
  "pix.charge.read",
  "pix.charge.cancel",
  "pix.charge.copy",
  "pix.charge.print",
  "pix.payment.read",
  "pix.charge.reconcile",
  "pix.webhook.read",
  "pix.webhook.reprocess",
  "pix.refund.create",
  "pix.refund.read",
  "pix.payment.receipt.print",
  "integrations.read",
  "integrations.manage",
  "dashboard.view",
  "dashboard.read",
  "dashboard.financial.read",
  "dashboard.operator.read",
  "cash.manage",
  "cash.register.read",
  "cash.register.create",
  "cash.register.update",
  "cash.register.disable",
  "cash.session.open",
  "cash.session.read",
  "cash.session.close",
  "cash.session.close.with_pending_charges",
  "cash.movement.read",
  "cash.movement.supply",
  "cash.movement.withdrawal",
  "cash.movement.withdrawal.override",
  "cash.reports.read",
  "reports.view",
  "reports.sales.read",
  "reports.payments.read",
  "reports.cash.read",
  "reports.reconciliation.read",
  "reports.export",
  "settings.manage",
  "settings.read",
  "settings.update",
  "print.settings.read",
  "print.settings.update",
  "users.manage",
  "users.read",
  "users.create",
  "users.update",
  "users.disable",
  "users.sessions.revoke",
  "roles.read",
  "roles.create",
  "roles.update",
  "roles.disable",
  "branches.manage",
  "branches.read",
  "branches.create",
  "branches.update",
  "branches.disable",
  "audit.read",
  "audit.details.read",
  "notifications.read",
  "notifications.update",
  "platform.dashboard.read",
  "platform.companies.read",
  "platform.companies.create",
  "platform.companies.update",
  "platform.companies.suspend",
  "platform.plans.manage",
  "platform.health.read",
] as const;

export type PermissionKey = (typeof permissionKeys)[number];

export const loginSchema = z.object({
  email: z.email("Informe um e-mail válido").transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres").max(128),
  mfaCode: z.string().trim().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().trim().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/).optional(),
});

export const passwordConfirmationSchema = z.object({ password: z.string().min(8).max(128) });
export const mfaCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });
export const mfaDisableSchema = z.object({ password: z.string().min(8).max(128), code: z.string().trim().regex(/^\d{6}$/) });
export const forgotPasswordSchema = z.object({ email: z.email().transform((value) => value.trim().toLowerCase()) });
export const resetPasswordSchema = z.object({ token: z.string().min(32).max(256), password: z.string().min(12).max(128) });

export const createBranchSchema = z.object({
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
});

export const updateBranchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/).optional(),
  timezone: z.string().trim().min(3).max(80).optional(),
  addressLine1: z.string().trim().max(180).nullable().optional(),
  addressLine2: z.string().trim().max(180).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  state: z.string().trim().length(2).toUpperCase().nullable().optional(),
  postalCode: z.string().trim().max(12).nullable().optional(),
}).refine((body) => Object.keys(body).length > 0, "Informe ao menos um campo");

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12).max(128),
  branchPublicId: z.uuid().nullable().optional(),
  roleKeys: z.array(z.string().trim().min(1).max(50)).min(1),
  requirePasswordChange: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.email().transform((value) => value.trim().toLowerCase()).optional(),
  branchPublicId: z.uuid().nullable().optional(),
  roleKeys: z.array(z.string().trim().min(1).max(50)).min(1).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).optional(),
  mustResetPassword: z.boolean().optional(),
}).refine((body) => Object.keys(body).length > 0, "Informe ao menos um campo");

export const setPasswordSchema = z.object({
  password: z.string().min(12).max(128),
  requirePasswordChange: z.boolean().optional(),
  mfaCode: z.string().trim().regex(/^\d{6}$/),
});

export const deleteUserSchema = z.object({
  mfaCode: z.string().trim().regex(/^\d{6}$/),
});

export const resetMfaSchema = z.object({
  mfaCode: z.string().trim().regex(/^\d{6}$/),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(12).max(128),
});

export const roleUpsertSchema = z.object({
  key: z.string().trim().min(2).max(50).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(80),
  permissionKeys: z.array(z.enum(permissionKeys)).min(1),
});

export const saleDraftSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Informe o código da venda")
    // Aceita espaços de forma transparente: remove os das extremidades (trim) e
    // troca os internos por hífen ("TESTE 1" → "TESTE-1"), colapsando repetições.
    .transform((value) => value.replace(/\s+/g, "-").replace(/-{2,}/g, "-"))
    .pipe(
      z
        .string()
        .max(64)
        .regex(/^[\p{L}\p{N}/_.-]+$/u, "Use letras, números, hífen, barra ou ponto"),
    ),
  amountInCents: z.number().int().positive("Informe um valor maior que zero"),
});

export const pixChargeCreateSchema = saleDraftSchema.extend({
  description: z.string().trim().max(240).optional(),
  // E-mail do cliente/pagador (opcional). A validação de domínio real (recusa .local)
  // e a resolução com o e-mail da empresa acontecem no backend antes de montar o payload.
  customerEmail: z.string().trim().max(180).optional(),
});

export const providerConfigurationSchema = z.object({
  accessToken: z.string().trim().min(16).max(512),
  webhookSecret: z.string().trim().min(16).max(512).optional(),
  environment: z.enum(["TEST", "PRODUCTION"]),
  pixExpirationMinutes: z.number().int().min(30).max(43_200).default(30),
});

export const printPixChargeSchema = z.object({
  paperWidth: z.enum(["MM58", "MM80"]),
});

const moneyInCentsSchema = z.number().int().min(0).max(99_999_999_999);
const optionalNoteSchema = z.string().trim().max(500).nullable().optional();

export const cashRegisterCreateSchema = z.object({
  branchPublicId: z.uuid(),
  name: z.string().trim().min(2, "Informe o nome do caixa").max(100),
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/, "Use letras, números, hífen ou sublinhado"),
  description: z.string().trim().max(240).nullable().optional(),
});

export const cashRegisterUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/).optional(),
  description: z.string().trim().max(240).nullable().optional(),
}).refine((body) => Object.keys(body).length > 0, "Informe ao menos um campo");

export const openCashSessionSchema = z.object({
  cashRegisterPublicId: z.uuid(),
  openingBalanceInCents: moneyInCentsSchema,
  note: optionalNoteSchema,
});

export const cashMovementCreateSchema = z.object({
  amountInCents: moneyInCentsSchema.positive("Informe um valor maior que zero"),
  reason: z.string().trim().min(3, "Informe o motivo").max(160),
  note: optionalNoteSchema,
});

export const closeCashSessionSchema = z.object({
  countedBalanceInCents: moneyInCentsSchema,
  note: optionalNoteSchema,
  confirmed: z.literal(true),
  allowPendingCharges: z.boolean().default(false),
});

export const pixRefundCreateSchema = z.object({
  amountInCents: z.number().int().positive().optional(),
  reason: z.string().trim().min(8).max(240),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const pixChargeHistoryQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["CREATING", "WAITING_PAYMENT", "PROCESSING", "PAID", "EXPIRED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "FAILED", "VALUE_MISMATCH", "UNDER_REVIEW"]).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  // Filtro por atendente (gestão admin): publicId do operador da venda.
  operator: z.uuid().optional(),
});

// Solicitação de estorno feita pelo atendente (a execução fica com o admin).
export const pixRefundRequestSchema = z.object({
  reason: z.string().trim().min(8, "Descreva o motivo do estorno").max(240),
});

export const pixRefundDenySchema = z.object({
  note: z.string().trim().max(240).optional(),
});

export const pixRefundListQuerySchema = paginationSchema.extend({
  status: z.enum(["REQUESTED", "PROCESSING", "PROCESSED", "FAILED", "CANCELLED"]).optional(),
});

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const analyticsFilterSchema = z.object({
  preset: z.enum(["today", "yesterday", "7d", "30d", "current_month", "previous_month", "custom"]).default("7d"),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  branchPublicId: z.uuid().optional(),
  operatorPublicId: z.uuid().optional(),
  cashRegisterPublicId: z.uuid().optional(),
}).refine((value) => value.preset !== "custom" || (value.from && value.to), "Informe o período personalizado");

export const reportFilterSchema = paginationSchema.extend({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  status: z.string().trim().max(40).optional(),
  branchPublicId: z.uuid().optional(),
  operatorPublicId: z.uuid().optional(),
  cashRegisterPublicId: z.uuid().optional(),
  cashSessionPublicId: z.uuid().optional(),
  minAmountInCents: z.coerce.number().int().min(0).optional(),
  maxAmountInCents: z.coerce.number().int().min(0).optional(),
  search: z.string().trim().max(120).optional(),
  movementType: z.string().trim().max(40).optional(),
  printType: z.string().trim().max(40).optional(),
});

export const exportRequestSchema = z.object({
  reportType: z.enum(["SALES", "PAYMENTS", "CHARGES", "CASH_SESSIONS", "CASH_MOVEMENTS", "RECONCILIATION", "AUDIT"]),
  format: z.enum(["CSV", "XLSX", "PDF"]),
  filters: reportFilterSchema.omit({ page: true, pageSize: true }).default({}),
});

// Item do catálogo rápido (produto/valor tocável no balcão).
export const quickItemSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do item").max(40),
  amountInCents: z.number().int().min(1).max(99_999_999),
});
export type QuickItemDto = z.infer<typeof quickItemSchema>;

export const companySettingsSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(3).max(80),
  defaultPixExpirationMinutes: z.number().int().min(30).max(43_200),
  confirmBeforePix: z.boolean(),
  blockDuplicateCode: z.boolean(),
  autoPrint: z.boolean(),
  printAfterConfirmation: z.boolean(),
  autoReturnToSale: z.boolean(),
  autoReturnSeconds: z.number().int().min(1).max(120),
  blockCloseWithPendingCharges: z.boolean(),
  minSaleAmountInCents: z.number().int().positive(),
  maxSaleAmountInCents: z.number().int().positive(),
  paymentSoundEnabled: z.boolean(),
  // E-mail válido da empresa usado como pagador do Pix quando o cliente não informa um.
  // "" limpa o valor. A validação de domínio real (recusa .local) é feita no backend.
  pixPayerEmail: z.string().trim().max(180).optional(),
  // Catálogo rápido: botões de produto/valor no balcão.
  quickItems: z.array(quickItemSchema).max(40).optional(),
}).refine((value) => value.maxSaleAmountInCents >= value.minSaleAmountInCents, "O valor máximo deve ser maior que o mínimo");

export const printTemplateSchema = z.object({
  storeName: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(120),
  messageAboveQr: z.string().trim().max(240).nullable().optional(),
  messageBelowQr: z.string().trim().max(240).nullable().optional(),
  footer: z.string().trim().max(300).nullable().optional(),
  paperWidth: z.enum(["MM58", "MM80"]),
  qrSize: z.number().int().min(120).max(420),
  alignment: z.enum(["LEFT", "CENTER", "RIGHT"]),
  showSaleCode: z.boolean(), showAmount: z.boolean(), showPixCopyPaste: z.boolean(),
  showDate: z.boolean(), showTime: z.boolean(), showExpiration: z.boolean(),
  showOperator: z.boolean(), showCashRegister: z.boolean(), showTransactionId: z.boolean(),
  showNonFiscalDisclaimer: z.boolean(), copies: z.number().int().min(1).max(3),
  cutSpacingMm: z.number().int().min(0).max(40), autoPrint: z.boolean(),
  printAfterConfirmation: z.boolean(), autoReturnToSale: z.boolean(), paymentSoundEnabled: z.boolean(),
});

export const logoUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  base64: z.string().min(16).max(4_000_000),
});

export const planSchema = z.object({
  key: z.string().trim().min(2).max(50).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(100), description: z.string().trim().min(2).max(300),
  priceInCents: z.number().int().min(0), billingPeriod: z.enum(["MONTHLY", "YEARLY"]),
  userLimit: z.number().int().positive(), branchLimit: z.number().int().positive(),
  cashRegisterLimit: z.number().int().positive(), monthlyChargeLimit: z.number().int().positive(),
  monthlyExportLimit: z.number().int().positive(), features: z.array(z.string().trim().min(1).max(80)).max(50),
});

export const cashSessionListQuerySchema = paginationSchema.extend({
  status: z.enum(["OPEN", "CLOSED"]).optional(),
  // Filtro por atendente (gestão admin): publicId do operador da sessão.
  operator: z.uuid().optional(),
});

export type CashMovementTypeDto =
  | "OPENING_BALANCE"
  | "SUPPLY"
  | "WITHDRAWAL"
  | "PIX_PAYMENT"
  | "PIX_REFUND"
  | "ADJUSTMENT"
  | "CLOSING_ADJUSTMENT";

export interface CashRegisterDto {
  publicId: string;
  code: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "INACTIVE";
  branch: { publicId: string; code: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface CashTotalsDto {
  openingBalance: string;
  supplies: string;
  withdrawals: string;
  confirmedPix: string;
  refunds: string;
  positiveAdjustments: string;
  negativeAdjustments: string;
  adjustments: string;
  expectedBalance: string;
  operationCount: number;
}

export interface CashSessionDto {
  publicId: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  openingNote: string | null;
  closingNote: string | null;
  expectedBalance: string | null;
  countedBalance: string | null;
  discrepancy: string | null;
  cashRegister: { publicId: string; code: string; name: string };
  branch: { publicId: string; code: string; name: string };
  operator: { publicId: string; name: string };
  closedBy: { publicId: string; name: string } | null;
  totals: CashTotalsDto;
  closedWithPendingCharges: boolean;
  hasPostCloseAdjustment: boolean;
  pendingChargeCount: number;
}

export interface CashMovementDto {
  publicId: string;
  type: CashMovementTypeDto;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  reason: string;
  note: string | null;
  sourceType: "MANUAL" | "PAYMENT" | "SYSTEM" | "PIX_PAYMENT" | "PIX_REFUND";
  sourceId: string | null;
  createdAt: string;
  operator: { publicId: string; name: string };
}

export interface PaginatedDto<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface SessionPrincipal {
  user: {
    publicId: string;
    name: string;
    email: string;
  };
  company: {
    publicId: string;
    displayName: string;
    slug: string;
  };
  branch: {
    publicId: string;
    name: string;
  } | null;
  roles: string[];
  permissions: PermissionKey[];
  sessionExpiresAt: string;
  mfaEnrollmentPending: boolean;
  mustResetPassword: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    correlationId?: string;
    details?: unknown;
  };
}

export type PixChargeStatusDto =
  | "CREATING"
  | "WAITING_PAYMENT"
  | "PROCESSING"
  | "PAID"
  | "EXPIRED"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "FAILED"
  | "VALUE_MISMATCH"
  | "UNDER_REVIEW";

export interface PixChargeDto {
  publicId: string;
  saleCode: string;
  description: string | null;
  amount: string;
  currency: "BRL";
  status: PixChargeStatusDto;
  qrCodeText: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string;
  createdAt: string;
  provider: "MERCADO_PAGO";
  providerMode: "real" | "mock";
  canCancel: boolean;
  paidAt: string | null;
  providerPaymentIdMasked: string | null;
  receivedAmount: string | null;
  paymentPublicId: string | null;
  companyPaymentSoundEnabled: boolean;
  cashRegister: { publicId: string; code: string; name: string };
}

export interface ProviderIntegrationDto {
  configured: boolean;
  provider: "MERCADO_PAGO";
  providerMode: "real" | "mock";
  environment: "TEST" | "PRODUCTION";
  status: string;
  credentialMasked: string | null;
  pixExpirationMinutes: number;
  lastVerifiedAt: string | null;
  lastVerificationError: string | null;
  webhookUrl: string;
  webhookSecretConfigured: boolean;
}

export interface PixChargeEventDto {
  eventId: string;
  chargePublicId: string;
  saleCode: string;
  status: PixChargeStatusDto;
  amount: string;
  paidAt: string | null;
  updatedAt: string;
  message: string;
}

export interface PixChargeHistoryItemDto {
  publicId: string;
  saleCode: string;
  amount: string;
  status: PixChargeStatusDto;
  operator: string;
  cashRegister: string;
  createdAt: string;
  providerPaymentIdMasked: string | null;
  paidAt: string | null;
  canPrintReceipt: boolean;
}

export interface DashboardSummaryDto {
  period: { from: string; to: string; timezone: string; label: string };
  primary: {
    received: string; confirmedPayments: number; averageTicket: string; pendingCharges: number;
    previousReceived: string; receivedVariationPercent: number | null; trend: "UP" | "DOWN" | "NEUTRAL";
  };
  secondary: {
    monthReceived: string; expiredCharges: number; cancelledCharges: number; refunds: string;
    conversionRate: number | null; averagePaymentSeconds: number | null; valueMismatches: number; openCashRegisters: number;
  };
  charts: {
    revenueByDay: Array<{ label: string; amount: string; count: number }>;
    revenueByHour: Array<{ hour: number; amount: string; count: number }>;
    statusDistribution: Array<{ status: PixChargeStatusDto; count: number }>;
    operators: Array<{ publicId: string; name: string; amount: string; count: number }>;
    branches: Array<{ publicId: string; name: string; amount: string; count: number }>;
  };
  recentPayments: Array<{ publicId: string; chargePublicId: string; saleCode: string; amount: string; status: string; operator: string; branch: string; paidAt: string }>;
}
