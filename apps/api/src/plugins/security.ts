import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
  await app.register(cors, {
    origin: env.APP_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", env.APP_URL],
        upgradeInsecureRequests: env.APP_ENV === "production" ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    ban: 3,
  });

  app.decorateRequest("correlationId", "");
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request, reply) => {
    request.correlationId = randomUUID();
    reply.header("x-correlation-id", request.correlationId);

    if (["GET", "HEAD", "OPTIONS"].includes(request.method) || request.url.startsWith("/api/v1/webhooks/mercado-pago")) return;
    const origin = request.headers.origin;
    if (origin && origin !== env.APP_URL) {
      throw new AppError(403, "ORIGIN_REJECTED", "Origem da requisição não permitida.");
    }
  });
}
