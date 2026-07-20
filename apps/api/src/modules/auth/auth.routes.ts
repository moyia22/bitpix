import { forgotPasswordSchema, loginSchema, mfaCodeSchema, mfaDisableSchema, passwordConfirmationSchema, resetPasswordSchema } from "@bitpix/contracts";
import { prisma } from "@bitpix/database";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { writeAudit } from "../../lib/audit.js";
import { authenticate } from "./auth.guard.js";
import { login } from "./auth.service.js";
import { beginMfaSetup, confirmMfaSetup, disableMfa } from "./mfa.service.js";
import { requestPasswordReset, resetPassword } from "./password-reset.service.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/login", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await login(request, body.email, body.password, body.mfaCode, body.recoveryCode);

    reply.setCookie(env.SESSION_COOKIE_NAME, result.token, {
      path: "/",
      httpOnly: true,
      secure: env.APP_ENV === "production",
      sameSite: "lax",
      maxAge: env.SESSION_TTL_HOURS * 60 * 60,
    });
    return reply.send({ data: result.principal });
  });

  app.post("/auth/password/forgot", { config: { rateLimit: { max: 3, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);
    await requestPasswordReset(request, body.email);
    return reply.status(202).send({ data: { message: "Se a conta existir, enviaremos as instruções de redefinição." } });
  });

  app.post("/auth/password/reset", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    await resetPassword(request, body.token, body.password);
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
    return reply.send({ data: { message: "Senha redefinida. Entre novamente." } });
  });

  app.post("/auth/mfa/setup", { preHandler: authenticate }, async (request) => {
    const body = passwordConfirmationSchema.parse(request.body);
    return { data: await beginMfaSetup(request, body.password) };
  });

  app.post("/auth/mfa/confirm", { preHandler: authenticate }, async (request) => {
    const body = mfaCodeSchema.parse(request.body);
    return { data: await confirmMfaSetup(request, body.code) };
  });

  app.post("/auth/mfa/disable", { preHandler: authenticate }, async (request, reply) => {
    const body = mfaDisableSchema.parse(request.body);
    await disableMfa(request, body.password, body.code);
    return reply.status(204).send();
  });

  app.get("/auth/me", { preHandler: authenticate }, async (request) => ({
    data: request.auth?.principal,
  }));

  app.post("/auth/logout", { preHandler: authenticate }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return reply.status(401).send();

    await prisma.userSession.update({
      where: { id: auth.sessionId },
      data: { revokedAt: new Date() },
    });
    await writeAudit({
      request,
      action: "auth.logout",
      entity: "UserSession",
      outcome: "SUCCESS",
    });
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
    return reply.status(204).send();
  });

  app.post("/auth/sessions/revoke-others", { preHandler: authenticate }, async (request) => {
    const auth = request.auth!;
    const result = await prisma.userSession.updateMany({
      where: {
        companyId: auth.companyId,
        userId: auth.userId,
        id: { not: auth.sessionId },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    await writeAudit({
      request,
      action: "auth.sessions.revoked",
      entity: "UserSession",
      metadata: { revokedCount: result.count },
    });
    return { data: { revokedCount: result.count } };
  });
}
