import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
const rootKey = Buffer.from(env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY, "base64");
function key(context: string): Buffer { return Buffer.from(hkdfSync("sha256", rootKey, Buffer.from("bitpix-v1"), Buffer.from(context), 32)); }
export function encryptSecret(value: string, context: string): { ciphertext: string; iv: string; authTag: string } { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(context), iv); const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex") }; }
export function decryptSecret(input: { ciphertext: string; iv: string; authTag: string }, context: string): string { const decipher = createDecipheriv("aes-256-gcm", key(context), Buffer.from(input.iv, "hex")); decipher.setAuthTag(Buffer.from(input.authTag, "hex")); return Buffer.concat([decipher.update(Buffer.from(input.ciphertext, "base64")), decipher.final()]).toString("utf8"); }
