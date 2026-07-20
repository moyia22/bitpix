import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

export interface EncryptedCredential {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  masked: string;
}

const algorithm = "aes-256-gcm";
const key = Buffer.from(env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY, "base64");

export function maskCredential(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 12) return "••••••••";
  return `${trimmed.slice(0, 7)}••••••••${trimmed.slice(-4)}`;
}

export function encryptCredential(value: string): EncryptedCredential {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value.trim(), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    keyVersion: 1,
    masked: maskCredential(value),
  };
}

export function decryptCredential(input: { credentialCiphertext: string | null; credentialIv: string | null; credentialAuthTag: string | null }): string {
  if (!input.credentialCiphertext || !input.credentialIv || !input.credentialAuthTag) {
    throw new Error("Credencial do provedor não configurada");
  }
  const decipher = createDecipheriv(algorithm, key, Buffer.from(input.credentialIv, "hex"));
  decipher.setAuthTag(Buffer.from(input.credentialAuthTag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.credentialCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptWebhookSecret(input: {
  webhookSecretCiphertext: string | null;
  webhookSecretIv: string | null;
  webhookSecretAuthTag: string | null;
}): string | null {
  if (!input.webhookSecretCiphertext || !input.webhookSecretIv || !input.webhookSecretAuthTag) return null;
  const decipher = createDecipheriv(algorithm, key, Buffer.from(input.webhookSecretIv, "hex"));
  decipher.setAuthTag(Buffer.from(input.webhookSecretAuthTag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.webhookSecretCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function validateCredentialShape(value: string, mode: "real" | "mock"): void {
  const credential = value.trim();
  if (mode === "mock") {
    if (!credential.startsWith("TEST-MOCK-")) throw new Error("No modo simulado, use uma credencial iniciada por TEST-MOCK-");
    return;
  }
  if (!/^(APP_USR|TEST)-[A-Za-z0-9_-]{16,}$/.test(credential)) {
    throw new Error("Formato de Access Token do Mercado Pago inválido");
  }
}
