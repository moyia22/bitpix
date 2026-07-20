import { createHmac, timingSafeEqual } from "node:crypto";

export function validateMercadoPagoSignature(input: {
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
  secret: string | undefined;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): "VALID" | "INVALID" | "NOT_CONFIGURED" {
  if (!input.secret) return "NOT_CONFIGURED";
  if (!input.signatureHeader || !input.requestId || !input.dataId) return "INVALID";
  const parts = Object.fromEntries(input.signatureHeader.split(",").map((part) => part.trim().split("=", 2)));
  if (!parts.ts || !parts.v1 || !/^\d+$/.test(parts.ts) || !/^[a-f0-9]{64}$/i.test(parts.v1)) return "INVALID";
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (Math.abs(nowSeconds - Number(parts.ts)) > (input.toleranceSeconds ?? 300)) return "INVALID";
  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${parts.ts};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  const received = parts.v1;
  if (expected.length !== received.length) return "INVALID";
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex")) ? "VALID" : "INVALID";
}
