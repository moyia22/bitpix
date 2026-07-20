import { PixChargeStatus } from "@bitpix/database";
import type { ProviderChargeStatus } from "./payment-provider.js";

export function mapProviderStatus(status?: string, detail?: string): ProviderChargeStatus {
  const value = status?.toLowerCase();
  if (["approved", "processed", "paid"].includes(value ?? "")) return "paid";
  if (["refunded"].includes(value ?? "")) return "refunded";
  if (["partially_refunded"].includes(value ?? "")) return "partially_refunded";
  if (["cancelled", "canceled"].includes(value ?? "")) return "cancelled";
  if (["expired"].includes(value ?? "") || detail?.toLowerCase().includes("expired")) return "expired";
  if (["processing", "in_process"].includes(value ?? "")) return "processing";
  if (["created", "pending", "action_required"].includes(value ?? "")) return "waiting_payment";
  if (["under_review", "in_mediation"].includes(value ?? "")) return "under_review";
  return "failed";
}

export function toPixChargeStatus(status: ProviderChargeStatus): PixChargeStatus {
  const mapping: Record<ProviderChargeStatus, PixChargeStatus> = {
    waiting_payment: PixChargeStatus.WAITING_PAYMENT,
    processing: PixChargeStatus.PROCESSING,
    paid: PixChargeStatus.PAID,
    expired: PixChargeStatus.EXPIRED,
    cancelled: PixChargeStatus.CANCELLED,
    failed: PixChargeStatus.FAILED,
    under_review: PixChargeStatus.UNDER_REVIEW,
    refunded: PixChargeStatus.REFUNDED,
    partially_refunded: PixChargeStatus.PARTIALLY_REFUNDED,
  };
  return mapping[status];
}
