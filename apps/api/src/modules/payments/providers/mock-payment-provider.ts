import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import type { CreatePixChargeInput, PaymentProvider, ProviderPaymentSnapshot, ProviderPixCharge } from "./payment-provider.js";

const mockOrders = new Map<string, ProviderPaymentSnapshot>();

export function setMockProviderOrderState(providerOrderId: string, update: Partial<ProviderPaymentSnapshot>): void {
  const current = mockOrders.get(providerOrderId);
  if (!current) throw new Error("Cobrança simulada não encontrada");
  mockOrders.set(providerOrderId, { ...current, ...update, providerUpdatedAt: update.providerUpdatedAt ?? new Date() });
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "MERCADO_PAGO" as const;
  readonly mode = "mock" as const;

  async testConnection(accessToken: string): Promise<{ accountId: string; nickname: string }> {
    if (!accessToken.startsWith("TEST-MOCK-")) throw new Error("Credencial simulada inválida");
    return { accountId: "mock-account", nickname: "Ambiente simulado BitPix" };
  }

  async createPixCharge(input: CreatePixChargeInput): Promise<ProviderPixCharge> {
    const orderId = `mock_order_${randomUUID()}`;
    const paymentId = `mock_payment_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + input.expirationMinutes * 60_000);
    const qrCodeText = `BITPIX-MOCK|${orderId}|${input.amount}|${input.externalReference}`;
    const dataUrl = await QRCode.toDataURL(qrCodeText, { margin: 2, width: 520, errorCorrectionLevel: "M" });
    const now = new Date();
    mockOrders.set(orderId, {
      providerOrderId: orderId,
      providerPaymentId: paymentId,
      externalReference: input.externalReference,
      amount: input.amount,
      currency: "BRL",
      status: "waiting_payment",
      statusDetail: "pending_waiting_transfer",
      liveMode: false,
      paidAt: null,
      providerCreatedAt: now,
      providerUpdatedAt: now,
      payerDataSanitized: null,
      sanitizedResponse: { mock: true, orderId, paymentId, externalReference: input.externalReference, amount: input.amount, currency: "BRL", status: "waiting_payment" },
    });
    return {
      providerOrderId: orderId,
      providerPaymentId: paymentId,
      status: "waiting_payment",
      qrCodeText,
      qrCodeBase64: dataUrl.replace(/^data:image\/png;base64,/, ""),
      ticketUrl: null,
      expiresAt,
      sanitizedResponse: {
        mock: true,
        orderId,
        paymentId,
        status: "created",
        externalReference: input.externalReference,
        amount: input.amount,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async cancelPixCharge(): Promise<void> {
    return Promise.resolve();
  }

  async getPixCharge(input: { providerOrderId: string }): Promise<ProviderPaymentSnapshot> {
    const snapshot = mockOrders.get(input.providerOrderId);
    if (!snapshot) throw new Error("Cobrança simulada não encontrada");
    return structuredClone(snapshot);
  }

  async refundPixPayment(input: { providerOrderId: string }): Promise<{ providerRefundId: string; snapshot: ProviderPaymentSnapshot }> {
    setMockProviderOrderState(input.providerOrderId, { status: "refunded", statusDetail: "refunded" });
    return { providerRefundId: `mock_refund_${randomUUID()}`, snapshot: await this.getPixCharge(input) };
  }
}
