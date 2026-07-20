import { env } from "../../../config/env.js";
import { MercadoPagoPaymentProvider } from "./mercado-pago-provider.js";
import { MockPaymentProvider } from "./mock-payment-provider.js";
import type { PaymentProvider } from "./payment-provider.js";

export function getPaymentProvider(): PaymentProvider {
  return env.PAYMENT_PROVIDER_MODE === "mock" ? new MockPaymentProvider() : new MercadoPagoPaymentProvider();
}
