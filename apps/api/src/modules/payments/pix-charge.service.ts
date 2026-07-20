import type { PixChargeDto } from "@bitpix/contracts";
import { env } from "../../config/env.js";

const cancellableStatuses = new Set(["CREATING", "WAITING_PAYMENT", "PROCESSING"]);

export function pixChargeDto(charge: {
  publicId: string;
  amount: { toFixed(decimalPlaces: number): string };
  currency: string;
  status: string;
  qrCodeText: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  providerPaymentId: string | null;
  receivedAmount: { toFixed(decimalPlaces: number): string } | null;
  payment: { publicId: string } | null;
  company: { paymentSoundEnabled: boolean };
  sale: { saleCode: string; description: string | null };
  cashSession: { cashRegister: { publicId: string; code: string; name: string } };
}): PixChargeDto {
  return {
    publicId: charge.publicId,
    saleCode: charge.sale.saleCode,
    description: charge.sale.description,
    amount: charge.amount.toFixed(2),
    currency: "BRL",
    status: charge.status as PixChargeDto["status"],
    qrCodeText: charge.qrCodeText,
    qrCodeBase64: charge.qrCodeBase64,
    ticketUrl: charge.ticketUrl,
    expiresAt: charge.expiresAt.toISOString(),
    createdAt: charge.createdAt.toISOString(),
    provider: "MERCADO_PAGO",
    providerMode: env.PAYMENT_PROVIDER_MODE,
    canCancel: cancellableStatuses.has(charge.status),
    paidAt: charge.paidAt?.toISOString() ?? null,
    providerPaymentIdMasked: charge.providerPaymentId ? `${charge.providerPaymentId.slice(0, 4)}••••${charge.providerPaymentId.slice(-4)}` : null,
    receivedAmount: charge.receivedAmount?.toFixed(2) ?? null,
    paymentPublicId: charge.payment?.publicId ?? null,
    companyPaymentSoundEnabled: charge.company.paymentSoundEnabled,
    cashRegister: charge.cashSession.cashRegister,
  };
}

export const pixChargeInclude = {
  sale: { select: { saleCode: true, description: true } },
  cashSession: { include: { cashRegister: { select: { publicId: true, code: true, name: true } } } },
  payment: { select: { publicId: true } },
  company: { select: { paymentSoundEnabled: true } },
} as const;
