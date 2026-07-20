import type { PermissionKey, SessionPrincipal } from "@bitpix/contracts";

declare module "fastify" {
  interface FastifyRequest {
    metricsStartedAt?: bigint;
    correlationId: string;
    auth: {
      sessionId: string;
      sessionTokenHash: string;
      userId: string;
      companyId: string;
      branchId: string | null;
      permissions: Set<PermissionKey>;
      principal: SessionPrincipal;
    } | null;
  }
}

export {};
