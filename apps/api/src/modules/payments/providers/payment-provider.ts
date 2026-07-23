export type ProviderChargeStatus = "waiting_payment" | "processing" | "paid" | "expired" | "cancelled" | "failed" | "under_review" | "refunded" | "partially_refunded";

export interface CreatePixChargeInput {
  amount: string;
  externalReference: string;
  description?: string;
  payerEmail: string;
  expirationMinutes: number;
  idempotencyKey: string;
  accessToken: string;
}

export interface ProviderPixCharge {
  providerOrderId: string;
  providerPaymentId: string | null;
  status: ProviderChargeStatus;
  qrCodeText: string;
  qrCodeBase64: string;
  ticketUrl: string | null;
  expiresAt: Date;
  sanitizedResponse: Record<string, unknown>;
}

export interface ProviderPaymentSnapshot {
  providerOrderId: string;
  providerPaymentId: string;
  externalReference: string;
  amount: string;
  currency: string;
  status: ProviderChargeStatus;
  statusDetail: string | null;
  liveMode: boolean | null;
  paidAt: Date | null;
  providerCreatedAt: Date | null;
  providerUpdatedAt: Date | null;
  payerDataSanitized: Record<string, unknown> | null;
  sanitizedResponse: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: "MERCADO_PAGO";
  readonly mode: "real" | "mock";
  testConnection(accessToken: string): Promise<{ accountId: string; nickname: string | null }>;
  createPixCharge(input: CreatePixChargeInput): Promise<ProviderPixCharge>;
  cancelPixCharge(input: { providerOrderId: string; idempotencyKey: string; accessToken: string }): Promise<void>;
  getPixCharge(input: { providerOrderId: string; accessToken: string }): Promise<ProviderPaymentSnapshot>;
  refundPixPayment(input: { providerOrderId: string; amount?: string; idempotencyKey: string; accessToken: string }): Promise<{ providerRefundId: string | null; snapshot: ProviderPaymentSnapshot }>;
}

export class ProviderError extends Error {
  constructor(
    public readonly code: "INVALID_CREDENTIAL" | "PERMISSION_DENIED" | "TIMEOUT" | "UNAVAILABLE" | "INVALID_RESPONSE" | "REJECTED",
    message: string,
    public readonly retryable = false,
    // Motivo bruto retornado pelo provedor (para log/auditoria); nunca contém segredos.
    public readonly detail?: string,
    // Resposta completa sanitizada do provedor (status HTTP, request-id, cause, etc.);
    // nunca contém access token, Authorization, cookie, QR Code ou payload Pix.
    public readonly sanitized?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
