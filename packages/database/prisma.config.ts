import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: "../../.env" });

const buildDatabaseUrl =
  "postgresql://build:build@localhost:5432/build";

const databaseUrl =
  process.env.DATABASE_URL || buildDatabaseUrl;

const directUrl =
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL ||
  buildDatabaseUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: databaseUrl,
    directUrl,
  },
});
