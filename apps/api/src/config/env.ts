import { resolve } from "node:path";
import { config } from "dotenv";
import { z } from "zod";

config({ path: resolve(process.cwd(), "../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().min(1).default("bitpix_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  PROVIDER_CREDENTIALS_ENCRYPTION_KEY: z.string().min(1),
  PAYMENT_PROVIDER_MODE: z.enum(["real", "mock"]).default("mock"),
  PAYMENT_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
  MERCADO_PAGO_API_BASE_URL: z.url().default("https://api.mercadopago.com"),
  MERCADO_PAGO_WEBHOOK_SECRET: z.string().optional().default(""),
  PUBLIC_WEBHOOK_BASE_URL: z.url().default("http://localhost:3333"),
  WEBHOOK_LOCAL_FALLBACK: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
  SSE_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().min(1).max(20).default(5),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().min(1).default(".runtime/storage"),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(3).optional(),
  S3_ACCESS_KEY: z.string().min(3).optional(),
  S3_SECRET_KEY: z.string().min(8).optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  S3_SERVER_SIDE_ENCRYPTION: z.enum(["AES256", "aws:kms"]).default("AES256"),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().min(3).default("BitPix <no-reply@localhost>"),
  REQUIRE_MFA_FOR_PLATFORM: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  REQUIRE_MFA_FOR_ADMINS: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
  APP_VERSION: z.string().min(1).default("0.1.0"),
  APP_COMMIT_SHA: z.string().min(1).default("development"),
  APP_BUILD_DATE: z.string().min(1).default("unknown"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(100).default(10),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
}).superRefine((value, context) => {
  let bytes = 0;
  try {
    bytes = Buffer.from(value.PROVIDER_CREDENTIALS_ENCRYPTION_KEY, "base64").length;
  } catch {
    bytes = 0;
  }
  if (bytes !== 32) {
    context.addIssue({ code: "custom", path: ["PROVIDER_CREDENTIALS_ENCRYPTION_KEY"], message: "deve conter exatamente 32 bytes em Base64" });
  }
  if (value.APP_ENV === "production" && value.PAYMENT_PROVIDER_MODE === "mock") {
    context.addIssue({ code: "custom", path: ["PAYMENT_PROVIDER_MODE"], message: "mock é proibido em produção" });
  }
  if (value.APP_ENV === "production" && !value.MERCADO_PAGO_API_BASE_URL.startsWith("https://")) {
    context.addIssue({ code: "custom", path: ["MERCADO_PAGO_API_BASE_URL"], message: "HTTPS é obrigatório em produção" });
  }
  if (value.APP_ENV === "production" && value.WEBHOOK_LOCAL_FALLBACK) {
    context.addIssue({ code: "custom", path: ["WEBHOOK_LOCAL_FALLBACK"], message: "fallback local é proibido em produção" });
  }
  if (value.APP_ENV === "production" && value.NODE_ENV !== "production") context.addIssue({ code: "custom", path: ["NODE_ENV"], message: "deve ser production" });
  if (value.APP_ENV === "production" && !value.APP_URL.startsWith("https://")) context.addIssue({ code: "custom", path: ["APP_URL"], message: "HTTPS é obrigatório" });
  if (value.APP_ENV === "production" && !value.PUBLIC_WEBHOOK_BASE_URL.startsWith("https://")) context.addIssue({ code: "custom", path: ["PUBLIC_WEBHOOK_BASE_URL"], message: "HTTPS público é obrigatório" });
  if (value.APP_ENV === "production" && value.STORAGE_DRIVER !== "s3") context.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "S3 privado é obrigatório em produção" });
  if (value.STORAGE_DRIVER === "s3" && (!value.S3_BUCKET || !value.S3_ACCESS_KEY || !value.S3_SECRET_KEY)) context.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "bucket e credenciais S3 são obrigatórios" });
  if (value.APP_ENV === "production" && (!value.SMTP_HOST || !value.SMTP_USER || !value.SMTP_PASSWORD)) context.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "SMTP autenticado é obrigatório em produção" });
  if (value.APP_ENV === "production" && !value.REQUIRE_MFA_FOR_PLATFORM) context.addIssue({ code: "custom", path: ["REQUIRE_MFA_FOR_PLATFORM"], message: "MFA do superadmin é obrigatório" });
  if (value.APP_ENV === "production" && !value.REQUIRE_MFA_FOR_ADMINS) context.addIssue({ code: "custom", path: ["REQUIRE_MFA_FOR_ADMINS"], message: "MFA de administradores é obrigatório" });
  if (value.APP_ENV === "production" && !/redis(s)?:\/\/[^:@/]+:[^@/]+@/.test(value.REDIS_URL)) context.addIssue({ code: "custom", path: ["REDIS_URL"], message: "Redis deve usar autenticação" });
});

export const env = envSchema.parse(process.env);
