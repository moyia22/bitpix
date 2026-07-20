import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), "../../.env") });
const [{ prisma }, { buildApp }, { env }, { closeRedis }] = await Promise.all([
  import("@bitpix/database"),
  import("./app.js"),
  import("./config/env.js"),
  import("./lib/redis.js"),
]);

const app = await buildApp();

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  const timeout = setTimeout(() => {
    app.log.error({ signal }, "shutdown timeout exceeded");
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);
  timeout.unref();
  try {
    await app.close();
    await closeRedis();
    await prisma.$disconnect();
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    app.log.error(error, "shutdown failed");
    process.exit(1);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  app.log.info({ port: env.API_PORT, appEnv: env.APP_ENV }, "BitPix API ready");
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
