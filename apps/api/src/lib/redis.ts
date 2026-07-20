import Redis from "ioredis";
import { env } from "../config/env.js";

let redis: Redis | undefined;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      connectTimeout: 1_000,
      commandTimeout: 1_500,
      retryStrategy: () => null,
    });
    redis.on("error", () => undefined);
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = undefined;
  }
}
