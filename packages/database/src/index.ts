import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurada");
  }

  // Conexões remotas (ex.: pooler do Supabase) usam TLS. O driver pg mais novo
  // trata sslmode=require como verify-full e rejeita a cadeia com raiz própria do
  // pooler. uselibpqcompat=true restaura a semântica do libpq (encripta sem
  // verificação estrita). Adicionamos automaticamente para hosts remotos, então
  // qualquer connection string do Supabase funciona sem flags extras.
  const isLocal = /@(localhost|127\.0\.0\.1|\[?::1\]?)[:/]/i.test(connectionString);
  const runtimeUrl = !isLocal && !/[?&]uselibpqcompat=/.test(connectionString)
    ? connectionString + (connectionString.includes("?") ? "&" : "?") + "uselibpqcompat=true"
    : connectionString;
  const adapter = new PrismaPg({ connectionString: runtimeUrl, max: Number(process.env.DATABASE_POOL_MAX ?? 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "./generated/prisma/client.js";
