import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapProviderStatus, toPixChargeStatus } from "../src/modules/payments/providers/status-mapper.js";
import { validateMercadoPagoSignature } from "../src/modules/payments/webhook-signature.js";

describe("normalização do provedor", () => {
  it("mapeia estados do Mercado Pago para o domínio", () => {
    expect(toPixChargeStatus(mapProviderStatus("created"))).toBe("WAITING_PAYMENT");
    expect(toPixChargeStatus(mapProviderStatus("approved"))).toBe("PAID");
    expect(toPixChargeStatus(mapProviderStatus("cancelled"))).toBe("CANCELLED");
    expect(toPixChargeStatus(mapProviderStatus("pending", "expired"))).toBe("EXPIRED");
  });

  it("valida a assinatura conforme o manifesto documentado", () => {
    const secret = "segredo-de-webhook";
    const manifest = "id:123;request-id:req-1;ts:1710000000;";
    const digest = createHmac("sha256", secret).update(manifest).digest("hex");
    expect(validateMercadoPagoSignature({ signatureHeader: `ts=1710000000,v1=${digest}`, requestId: "req-1", dataId: "123", secret, nowSeconds: 1710000000 })).toBe("VALID");
    expect(validateMercadoPagoSignature({ signatureHeader: "ts=1710000000,v1=invalid", requestId: "req-1", dataId: "123", secret, nowSeconds: 1710000000 })).toBe("INVALID");
    expect(validateMercadoPagoSignature({ signatureHeader: `ts=1710000000,v1=${digest}`, requestId: "req-1", dataId: "123", secret, nowSeconds: 1710001000 })).toBe("INVALID");
  });
});
