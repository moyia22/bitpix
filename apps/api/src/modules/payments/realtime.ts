import { EventEmitter } from "node:events";
import type { PixChargeEventDto } from "@bitpix/contracts";
import type Redis from "ioredis";
import { getRedis } from "../../lib/redis.js";
import { incrementPaymentMetric } from "./payment-metrics.js";

const emitter = new EventEmitter();
emitter.setMaxListeners(500);
const channel = "bitpix:pix-charge-events";
let subscriber: Redis | null = null;

export interface ScopedChargeEvent extends PixChargeEventDto {
  companyId: string;
}

function emitLocal(event: ScopedChargeEvent): void {
  emitter.emit(`${event.companyId}:${event.chargePublicId}`, event);
}

export async function publishChargeEvent(event: ScopedChargeEvent): Promise<void> {
  emitLocal(event);
  const redis = getRedis();
  if (redis.status !== "ready") return;
  try {
    await redis.publish(channel, JSON.stringify(event));
  } catch {
    // O evento local e o polling continuam disponíveis; readiness permanece degradado.
  }
}

export async function ensureRealtimeSubscriber(): Promise<void> {
  if (subscriber) return;
  const redis = getRedis();
  if (redis.status !== "ready") return;
  subscriber = redis.duplicate({ maxRetriesPerRequest: null });
  subscriber.on("message", (_channel, payload) => {
    try { emitLocal(JSON.parse(payload) as ScopedChargeEvent); } catch { /* payload inválido é ignorado */ }
  });
  await subscriber.subscribe(channel);
}

export function subscribeToCharge(companyId: string, chargePublicId: string, listener: (event: ScopedChargeEvent) => void): () => void {
  const key = `${companyId}:${chargePublicId}`;
  emitter.on(key, listener);
  incrementPaymentMetric("sse_connections_total");
  return () => emitter.off(key, listener);
}
