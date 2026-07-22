import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ path: "../../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Runtime usa DATABASE_URL (pooler do Supabase). Migrations usam DIRECT_URL
    // (conexão direta), evitando o modo transaction do PgBouncer. Em ambiente
    // local, DIRECT_URL = DATABASE_URL.
    url: env("DATABASE_URL"),
    directUrl: env("DIRECT_URL"),
  },
});
