import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Revise os campos informados.",
          correlationId: request.correlationId,
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          correlationId: request.correlationId,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }

    request.log.error({ err: error, correlationId: request.correlationId }, "request failed");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Não foi possível concluir a operação.",
        correlationId: request.correlationId,
      },
    });
  });
}
