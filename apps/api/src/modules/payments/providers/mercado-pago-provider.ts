import { MercadoPagoConfig, Order } from "mercadopago";
import { env } from "../../../config/env.js";
import { mapProviderStatus } from "./status-mapper.js";
import { ProviderError, type CreatePixChargeInput, type PaymentProvider, type ProviderPaymentSnapshot, type ProviderPixCharge } from "./payment-provider.js";

// Extrai o motivo legível do erro do Mercado Pago. O SDK lança o corpo JSON de
// erro cru (Orders → { errors: [...] }, Payments → { message, cause: [...] }),
// então tentamos todas as formas conhecidas sem vazar dados sensíveis.
function extractProviderDetail(value: {
  message?: string; error?: string;
  cause?: Array<{ code?: string | number; description?: string }> | unknown;
  errors?: Array<{ code?: string; message?: string }> | unknown;
}): string | undefined {
  const parts: string[] = [];
  if (Array.isArray(value.errors)) {
    for (const item of value.errors) parts.push([item?.code, item?.message].filter(Boolean).join(": "));
  }
  if (Array.isArray(value.cause)) {
    for (const item of value.cause) parts.push([item?.code, item?.description].filter(Boolean).join(": "));
  }
  const joined = parts.filter(Boolean).join(" | ");
  if (joined) return joined.slice(0, 400);
  if (typeof value.message === "string" && value.message) return value.message.slice(0, 400);
  if (typeof value.error === "string" && value.error) return value.error.slice(0, 400);
  return undefined;
}

function providerError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const value = (error ?? {}) as {
    status?: number | string; statusCode?: number; name?: string; message?: string; error?: string;
    api_response?: { status?: number };
    cause?: Array<{ code?: string | number; description?: string }>;
    errors?: Array<{ code?: string; message?: string }>;
  };

  // Timeout / abort da nossa camada → transitório (retentável).
  if (value.name === "AbortError" || /timeout|aborted|abort/i.test(value.message ?? "")) {
    return new ProviderError("TIMEOUT", "O Mercado Pago não respondeu dentro do tempo limite.", true, value.message);
  }

  const httpStatus =
    typeof value.status === "number" ? value.status
    : typeof value.statusCode === "number" ? value.statusCode
    : typeof value.api_response?.status === "number" ? value.api_response.status
    : undefined;
  const detail = extractProviderDetail(value);
  const hasErrorBody = Array.isArray(value.errors) || Array.isArray(value.cause) || typeof value.error === "string";

  if (httpStatus === 401) return new ProviderError("INVALID_CREDENTIAL", "Access Token recusado pelo Mercado Pago.", false, detail);
  if (httpStatus === 403) return new ProviderError("PERMISSION_DENIED", "A credencial não possui permissão para esta operação.", false, detail);
  if (httpStatus === 429) return new ProviderError("UNAVAILABLE", "Limite de requisições do Mercado Pago atingido. Tente novamente.", true, detail);
  if (typeof httpStatus === "number" && httpStatus >= 500) {
    return new ProviderError("UNAVAILABLE", "O Mercado Pago está temporariamente indisponível.", true, detail);
  }
  if (typeof httpStatus === "number" && httpStatus >= 400) {
    return new ProviderError("REJECTED", detail ? `O Mercado Pago recusou a cobrança: ${detail}` : "O Mercado Pago recusou a solicitação.", false, detail);
  }

  // Sem status HTTP mas com corpo de erro estruturado → é uma rejeição do provedor
  // (não uma indisponibilidade). Antes isso caía no default e virava 504 mascarado.
  if (hasErrorBody && detail) {
    return new ProviderError("REJECTED", `O Mercado Pago recusou a cobrança: ${detail}`, false, detail);
  }

  // Falha de rede/desconhecida sem resposta do provedor → transitório.
  return new ProviderError("UNAVAILABLE", "O Mercado Pago está temporariamente indisponível.", true, detail ?? value.message);
}

function expirationDuration(minutes: number): string {
  if (minutes % 1_440 === 0) return `P${minutes / 1_440}D`;
  if (minutes % 60 === 0) return `PT${minutes / 60}H`;
  return `PT${minutes}M`;
}

// Forma da resposta da Orders API do Mercado Pago (sucesso e erro).
interface MpOrderResponse {
  id?: string; status?: string; status_detail?: string; external_reference?: string;
  total_amount?: string; created_date?: string;
  message?: string; error?: string;
  cause?: Array<{ code?: string | number; description?: string }>;
  errors?: Array<{ code?: string; message?: string; details?: unknown }>;
  transactions?: {
    payments?: Array<{
      id?: string; status?: string; status_detail?: string; date_of_expiration?: string;
      payment_method?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string };
    }>;
  };
}

function truncate(value: unknown, max = 300): string | null {
  if (value === null || value === undefined) return null;
  try { return (typeof value === "string" ? value : JSON.stringify(value)).slice(0, max); }
  catch { return null; }
}

// Captura sanitizada da resposta do Mercado Pago. NUNCA inclui access token,
// Authorization, cookie, QR Code, payload Pix completo ou identificação do pagador.
function sanitizeMpResponse(httpStatus: number, requestId: string | null, body: MpOrderResponse): Record<string, unknown> {
  const payment = body.transactions?.payments?.[0];
  return {
    httpStatus,
    requestId,
    message: body.message ?? null,
    error: body.error ?? null,
    orderStatus: body.status ?? null,
    orderStatusDetail: body.status_detail ?? null,
    paymentStatus: payment?.status ?? null,
    paymentStatusDetail: payment?.status_detail ?? null,
    cause: Array.isArray(body.cause) ? body.cause.map((c) => ({ code: c?.code ?? null, description: truncate(c?.description) })) : null,
    errors: Array.isArray(body.errors) ? body.errors.map((e) => ({ code: e?.code ?? null, message: truncate(e?.message), details: truncate(e?.details) })) : null,
  };
}

// Motivo mais específico disponível, do mais preciso ao mais genérico.
function specificDetail(body: MpOrderResponse): string {
  const payment = body.transactions?.payments?.[0];
  const errorsJoined = Array.isArray(body.errors)
    ? body.errors.map((e) => [e?.code, e?.message].filter(Boolean).join(": ")).filter(Boolean).join(" | ")
    : "";
  const causeJoined = Array.isArray(body.cause)
    ? body.cause.map((c) => [c?.code, c?.description].filter(Boolean).join(": ")).filter(Boolean).join(" | ")
    : "";
  return (payment?.status_detail || body.status_detail || errorsJoined || causeJoined || body.message || body.error || "recusada pelo provedor").slice(0, 400);
}

// Mensagem segura e específica para o operador, a partir do motivo bruto do MP.
function friendlyRejection(detail: string): string {
  const d = detail.toLowerCase();
  if (d.includes("pix") && /(not|unavailable|enabled|disabled|habilit|indispon)/.test(d)) {
    return "A conta do Mercado Pago não está habilitada para receber Pix. Cadastre e valide uma chave Pix na conta do recebedor.";
  }
  if (d.includes("collector") || (d.includes("payer") && d.includes("same"))) {
    return "O pagador não pode ser o mesmo titular da conta que recebe. Ajuste o e-mail do pagador da cobrança.";
  }
  if (d.includes("email")) return "O e-mail do pagador foi recusado pelo Mercado Pago. Use um e-mail válido.";
  if (d.includes("amount")) return "O valor da cobrança foi recusado pelo Mercado Pago. Verifique o valor mínimo/máximo.";
  return `O Mercado Pago recusou a cobrança (${detail}).`;
}

// Erro de uma resposta HTTP não-2xx (ou order sem Pix) da criação de cobrança.
function rejectionError(httpStatus: number, requestId: string | null, body: MpOrderResponse): ProviderError {
  const sanitized = sanitizeMpResponse(httpStatus, requestId, body);
  const detail = specificDetail(body);
  if (httpStatus === 401) return new ProviderError("INVALID_CREDENTIAL", "Access Token recusado pelo Mercado Pago.", false, detail, sanitized);
  if (httpStatus === 403) return new ProviderError("PERMISSION_DENIED", "A credencial não tem permissão para criar cobranças Pix.", false, detail, sanitized);
  if (httpStatus === 429) return new ProviderError("UNAVAILABLE", "Limite de requisições do Mercado Pago atingido. Tente novamente.", true, detail, sanitized);
  if (httpStatus >= 500) return new ProviderError("UNAVAILABLE", "O Mercado Pago está temporariamente indisponível.", true, detail, sanitized);
  return new ProviderError("REJECTED", friendlyRejection(detail), false, detail, sanitized);
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
    // Chamada direta (mesmo payload de antes), para capturar status HTTP, x-request-id
    // e o corpo completo de erro — o SDK descartava esses dados na rejeição.
    let response: Response;
    try {
      response = await fetch(`${env.MERCADO_PAGO_API_BASE_URL}/v1/orders`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/json",
          "x-idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({
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
        }),
        signal: AbortSignal.timeout(env.PAYMENT_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout/rede (AbortError etc.) → transitório.
      throw providerError(error);
    }

    const requestId = response.headers.get("x-request-id") ?? response.headers.get("x-mp-request-id");
    const body = await response.json().catch(() => ({})) as MpOrderResponse;

    if (!response.ok) throw rejectionError(response.status, requestId, body);

    const payment = body.transactions?.payments?.[0];
    const qrCodeText = payment?.payment_method?.qr_code;
    const qrCodeBase64 = payment?.payment_method?.qr_code_base64;
    // Order criada (2xx) mas o pagamento Pix não gerou QR → transação recusada: expõe o motivo real.
    if (!body.id || !qrCodeText || !qrCodeBase64) throw rejectionError(response.status, requestId, body);

    return {
      providerOrderId: body.id,
      providerPaymentId: payment?.id ?? null,
      status: mapProviderStatus(payment?.status ?? body.status, payment?.status_detail ?? body.status_detail),
      qrCodeText,
      qrCodeBase64: qrCodeBase64.replace(/^data:image\/[a-z+]+;base64,/i, ""),
      ticketUrl: payment?.payment_method?.ticket_url ?? null,
      expiresAt: payment?.date_of_expiration ? new Date(payment.date_of_expiration) : new Date(Date.now() + input.expirationMinutes * 60_000),
      sanitizedResponse: {
        mock: false,
        orderId: body.id,
        paymentId: payment?.id ?? null,
        orderStatus: body.status ?? null,
        paymentStatus: payment?.status ?? null,
        statusDetail: payment?.status_detail ?? body.status_detail ?? null,
        externalReference: body.external_reference ?? input.externalReference,
        amount: body.total_amount ?? input.amount,
        createdDate: body.created_date ?? null,
      },
    };
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
