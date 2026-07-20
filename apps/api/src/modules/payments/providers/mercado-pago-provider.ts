import { MercadoPagoConfig, Order } from "mercadopago";
import { env } from "../../../config/env.js";
import { mapProviderStatus } from "./status-mapper.js";
import { ProviderError, type CreatePixChargeInput, type PaymentProvider, type ProviderPaymentSnapshot, type ProviderPixCharge } from "./payment-provider.js";

function providerError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const value = error as { status?: number; statusCode?: number; cause?: Array<{ code?: string }>; message?: string; name?: string };
  const status = value.status ?? value.statusCode;
  if (status === 401) return new ProviderError("INVALID_CREDENTIAL", "Access Token recusado pelo Mercado Pago.");
  if (status === 403) return new ProviderError("PERMISSION_DENIED", "A credencial não possui permissão para esta operação.");
  if (value.name === "AbortError" || /timeout/i.test(value.message ?? "")) return new ProviderError("TIMEOUT", "O Mercado Pago não respondeu dentro do tempo limite.", true);
  if (status && status >= 400 && status < 500) return new ProviderError("REJECTED", "O Mercado Pago recusou a solicitação.");
  return new ProviderError("UNAVAILABLE", "O Mercado Pago está temporariamente indisponível.", true);
}

function expirationDuration(minutes: number): string {
  if (minutes % 1_440 === 0) return `P${minutes / 1_440}D`;
  if (minutes % 60 === 0) return `PT${minutes / 60}H`;
  return `PT${minutes}M`;
}

export class MercadoPagoPaymentProvider implements PaymentProvider {
  readonly name = "MERCADO_PAGO" as const;
  readonly mode = "real" as const;

  private order(accessToken: string): Order {
    return new Order(new MercadoPagoConfig({ accessToken, options: { timeout: env.PAYMENT_PROVIDER_TIMEOUT_MS } }));
  }

  async testConnection(accessToken: string): Promise<{ accountId: string; nickname: string | null }> {
    try {
      const response = await fetch(`${env.MERCADO_PAGO_API_BASE_URL}/users/me`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(env.PAYMENT_PROVIDER_TIMEOUT_MS),
      });
      if (response.status === 401) throw new ProviderError("INVALID_CREDENTIAL", "Access Token recusado pelo Mercado Pago.");
      if (response.status === 403) throw new ProviderError("PERMISSION_DENIED", "A credencial não possui permissão para consultar a conta.");
      if (!response.ok) throw new ProviderError("UNAVAILABLE", "Não foi possível validar a conta no Mercado Pago.", response.status >= 500);
      const body = await response.json() as { id?: number | string; nickname?: string };
      if (!body.id) throw new ProviderError("INVALID_RESPONSE", "Resposta de validação incompleta do Mercado Pago.");
      return { accountId: String(body.id), nickname: body.nickname ?? null };
    } catch (error) {
      throw providerError(error);
    }
  }

  async createPixCharge(input: CreatePixChargeInput): Promise<ProviderPixCharge> {
    try {
      const response = await this.order(input.accessToken).create({
        body: {
          type: "online",
          processing_mode: "automatic",
          total_amount: input.amount,
          currency: "BRL",
          external_reference: input.externalReference,
          ...(input.description ? { description: input.description } : {}),
          expiration_time: expirationDuration(input.expirationMinutes),
          payer: { email: input.payerEmail },
          transactions: {
            payments: [{
              amount: input.amount,
              expiration_time: expirationDuration(input.expirationMinutes),
              payment_method: { id: "pix", type: "bank_transfer" },
            }],
          },
        },
        requestOptions: { idempotencyKey: input.idempotencyKey },
      });
      const payment = response.transactions?.payments?.[0];
      const qrCodeText = payment?.payment_method?.qr_code;
      const qrCodeBase64 = payment?.payment_method?.qr_code_base64;
      if (!response.id || !qrCodeText || !qrCodeBase64) {
        throw new ProviderError("INVALID_RESPONSE", "O Mercado Pago não retornou os dados obrigatórios do Pix.");
      }
      return {
        providerOrderId: response.id,
        providerPaymentId: payment.id ?? null,
        status: mapProviderStatus(payment.status ?? response.status, payment.status_detail ?? response.status_detail),
        qrCodeText,
        qrCodeBase64: qrCodeBase64.replace(/^data:image\/[a-z+]+;base64,/i, ""),
        ticketUrl: payment.payment_method?.ticket_url ?? null,
        expiresAt: payment.date_of_expiration ? new Date(payment.date_of_expiration) : new Date(Date.now() + input.expirationMinutes * 60_000),
        sanitizedResponse: {
          mock: false,
          orderId: response.id,
          paymentId: payment.id ?? null,
          orderStatus: response.status ?? null,
          paymentStatus: payment.status ?? null,
          statusDetail: payment.status_detail ?? response.status_detail ?? null,
          externalReference: response.external_reference ?? input.externalReference,
          amount: response.total_amount ?? input.amount,
          createdDate: response.created_date ?? null,
        },
      };
    } catch (error) {
      throw providerError(error);
    }
  }

  async cancelPixCharge(input: { providerOrderId: string; idempotencyKey: string; accessToken: string }): Promise<void> {
    try {
      await this.order(input.accessToken).cancel({ id: input.providerOrderId, requestOptions: { idempotencyKey: input.idempotencyKey } });
    } catch (error) {
      throw providerError(error);
    }
  }

  async getPixCharge(input: { providerOrderId: string; accessToken: string }): Promise<ProviderPaymentSnapshot> {
    try {
      const response = await fetch(`${env.MERCADO_PAGO_API_BASE_URL}/v1/orders/${encodeURIComponent(input.providerOrderId)}`, {
        headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(env.PAYMENT_PROVIDER_TIMEOUT_MS),
      });
      if (response.status === 401) throw new ProviderError("INVALID_CREDENTIAL", "Access Token recusado pelo Mercado Pago.");
      if (response.status === 403) throw new ProviderError("PERMISSION_DENIED", "A credencial não possui permissão para consultar esta cobrança.");
      if (!response.ok) throw new ProviderError(response.status >= 500 ? "UNAVAILABLE" : "REJECTED", "Não foi possível consultar a cobrança no Mercado Pago.", response.status >= 500);
      const body = await response.json() as Record<string, unknown> & {
        id?: string; external_reference?: string; total_amount?: string; currency?: string; status?: string; status_detail?: string;
        created_date?: string; last_updated_date?: string; live_mode?: boolean;
        transactions?: { payments?: Array<{ id?: string; amount?: string; paid_amount?: string; status?: string; status_detail?: string; date_approved?: string; date_created?: string; date_last_updated?: string; payer?: { email?: string; identification?: { type?: string; number?: string } } }> };
      };
      const payment = body.transactions?.payments?.[0];
      if (!body.id || !body.external_reference || !payment?.id) throw new ProviderError("INVALID_RESPONSE", "Resposta de consulta incompleta do Mercado Pago.");
      const amount = payment.paid_amount ?? payment.amount ?? body.total_amount;
      if (!amount) throw new ProviderError("INVALID_RESPONSE", "O Mercado Pago não retornou o valor da cobrança.");
      const sanitizeIdentification = payment.payer?.identification?.number;
      return {
        providerOrderId: body.id,
        providerPaymentId: payment.id,
        externalReference: body.external_reference,
        amount: String(amount),
        currency: String(body.currency ?? ""),
        status: mapProviderStatus(payment.status ?? body.status, payment.status_detail ?? body.status_detail),
        statusDetail: payment.status_detail ?? body.status_detail ?? null,
        liveMode: body.live_mode ?? null,
        paidAt: payment.date_approved ? new Date(payment.date_approved) : null,
        providerCreatedAt: payment.date_created ? new Date(payment.date_created) : body.created_date ? new Date(body.created_date) : null,
        providerUpdatedAt: payment.date_last_updated ? new Date(payment.date_last_updated) : body.last_updated_date ? new Date(body.last_updated_date) : null,
        payerDataSanitized: payment.payer ? {
          emailDomain: payment.payer.email?.split("@")[1] ?? null,
          identificationType: payment.payer.identification?.type ?? null,
          identificationLast4: sanitizeIdentification ? sanitizeIdentification.slice(-4) : null,
        } : null,
        sanitizedResponse: { orderId: body.id, paymentId: payment.id, externalReference: body.external_reference, amount: String(amount), currency: body.currency ?? null, orderStatus: body.status ?? null, paymentStatus: payment.status ?? null, statusDetail: payment.status_detail ?? body.status_detail ?? null, createdDate: body.created_date ?? null, updatedDate: body.last_updated_date ?? null },
      };
    } catch (error) {
      throw providerError(error);
    }
  }

  async refundPixPayment(input: { providerOrderId: string; amount?: string; idempotencyKey: string; accessToken: string }): Promise<{ providerRefundId: string | null; snapshot: ProviderPaymentSnapshot }> {
    try {
      const response = await fetch(`${env.MERCADO_PAGO_API_BASE_URL}/v1/orders/${encodeURIComponent(input.providerOrderId)}/refund`, {
        method: "POST",
        headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json", "x-idempotency-key": input.idempotencyKey },
        body: JSON.stringify(input.amount ? { transactions: [{ amount: input.amount }] } : {}),
        signal: AbortSignal.timeout(env.PAYMENT_PROVIDER_TIMEOUT_MS),
      });
      if (!response.ok) throw new ProviderError(response.status >= 500 ? "UNAVAILABLE" : "REJECTED", "O Mercado Pago não confirmou o reembolso.", response.status >= 500);
      const body = await response.json() as { transactions?: { refunds?: Array<{ id?: string }> } };
      return { providerRefundId: body.transactions?.refunds?.[0]?.id ?? null, snapshot: await this.getPixCharge(input) };
    } catch (error) {
      throw providerError(error);
    }
  }
}
