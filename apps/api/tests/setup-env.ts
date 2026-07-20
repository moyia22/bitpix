import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), "../../.env") });

// Os testes usam sempre o provider simulado e determinístico, independentemente
// do modo operacional configurado no .env (que pode estar em "real" em runtime).
process.env.PAYMENT_PROVIDER_MODE = "mock";
process.env.APP_ENV = "development";
process.env.WEBHOOK_LOCAL_FALLBACK = "true";
// Testes são herméticos: não usam o Redis/worker reais. Um Redis inalcançável força
// o processamento síncrono in-process (mesmo MercadoPagoWebhookProcessor), evitando
// que um worker externo consuma a fila compartilhada durante os testes.
process.env.REDIS_URL = "redis://127.0.0.1:6399";
