# Admin User Management + Mandatory Admin 2FA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins full user management from the panel (create/edit/set-password/delete/reset-2FA/revoke) and require TOTP 2FA for admins at login and on sensitive actions.

**Architecture:** Fastify + Prisma backend, Next.js frontend. Reuse existing MFA (`mfa.service.ts`), sessions, and audit. No DB migration — all fields already exist. MFA enrollment uses a "grace session" (Approach A): login succeeds but the session is restricted to MFA setup until TOTP is confirmed. Sensitive endpoints require a step-up TOTP code in the request body.

**Tech Stack:** TypeScript, Fastify 5, Prisma 7, Zod, Vitest, Next.js 16/React 19, lucide-react, argon2.

## Global Constraints

- No database migration. Use existing fields: `User.mfaEnabled`, `mfaSecretCiphertext/Iv/AuthTag`, `mustResetPassword`, `recoveryCodesVersion`, `MfaRecoveryCode`, `PasswordResetToken`.
- Password policy for admin-set/self-change passwords: `z.string().min(12).max(128)` (matches `resetPasswordSchema`).
- TOTP code shape: `z.string().trim().regex(/^\d{6}$/)`.
- Every sensitive endpoint: permission check (`requireAnyPermission`) + step-up MFA (`assertStepUpMfa`) + `writeAudit`.
- Never log passwords, secrets, or recovery codes. Recovery codes stored only as SHA-256 hash (already implemented).
- Cannot delete/deactivate/reset-password the acting account via admin routes (`SELF_*_FORBIDDEN`).
- Run gates from repo root: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`. Unit tests are hermetic (setup forces mock provider + unreachable Redis).
- Follow existing code style: `AppError(status, CODE, message)`, `requireAnyPermission(...)`, `writeAudit({ request, action, entity, entityPublicId, ... })`, `prisma.$transaction`.

---

### Task 1: Contracts — schemas and principal fields

**Files:**
- Modify: `packages/contracts/src/index.ts` (schemas near line 108-123; `SessionPrincipal` near line 362)
- Test: `packages/contracts` has no test runner; validated via API tests + typecheck.

**Interfaces:**
- Produces: `setPasswordSchema`, `deleteUserSchema`, `resetMfaSchema`, `changePasswordSchema`; `createUserSchema` gains `requirePasswordChange?: boolean`; `SessionPrincipal` gains `mfaEnrollmentPending: boolean` and `mustResetPassword: boolean`.

- [ ] **Step 1: Add `requirePasswordChange` to `createUserSchema`**

In `createUserSchema` (line ~108) add the field:

```ts
export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12).max(128),
  branchPublicId: z.uuid().nullable().optional(),
  roleKeys: z.array(z.string().trim().min(1).max(50)).min(1),
  requirePasswordChange: z.boolean().optional(),
});
```

- [ ] **Step 2: Add the new admin/self schemas** (after `updateUserSchema`, ~line 123)

```ts
export const setPasswordSchema = z.object({
  password: z.string().min(12).max(128),
  requirePasswordChange: z.boolean().optional(),
  mfaCode: z.string().trim().regex(/^\d{6}$/),
});

export const deleteUserSchema = z.object({
  mfaCode: z.string().trim().regex(/^\d{6}$/),
});

export const resetMfaSchema = z.object({
  mfaCode: z.string().trim().regex(/^\d{6}$/),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(12).max(128),
});
```

- [ ] **Step 3: Add fields to `SessionPrincipal`** (after `sessionExpiresAt`, ~line 379)

```ts
  roles: string[];
  permissions: PermissionKey[];
  sessionExpiresAt: string;
  mfaEnrollmentPending: boolean;
  mustResetPassword: boolean;
}
```

- [ ] **Step 4: Build contracts and typecheck**

Run: `npm run build --workspace @bitpix/contracts && npm run typecheck`
Expected: contracts build OK; typecheck will FAIL in api/web where `SessionPrincipal` is constructed without the new fields — that is expected and fixed in Tasks 4 and 13.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/index.ts
git commit -m "feat(contracts): schemas for admin user mgmt + 2FA principal flags"
```

---

### Task 2: Env flag `REQUIRE_MFA_FOR_ADMINS`

**Files:**
- Modify: `apps/api/src/config/env.ts` (schema near line 41; production refinement near line 73)
- Modify: `.env.example`, `.env.development.example`, `.env.staging.example`, `.env.production.example`

**Interfaces:**
- Produces: `env.REQUIRE_MFA_FOR_ADMINS: boolean`.

- [ ] **Step 1: Add the env field** (after `REQUIRE_MFA_FOR_PLATFORM`, line ~41)

```ts
  REQUIRE_MFA_FOR_ADMINS: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
```

- [ ] **Step 2: Enforce in production** (in the `superRefine`, next to the platform MFA check, line ~73)

```ts
  if (value.APP_ENV === "production" && !value.REQUIRE_MFA_FOR_ADMINS) context.addIssue({ code: "custom", path: ["REQUIRE_MFA_FOR_ADMINS"], message: "MFA de administradores é obrigatório" });
```

- [ ] **Step 3: Document in env examples**

Add to `.env.example` and `.env.development.example` (under the MFA section):
```
REQUIRE_MFA_FOR_ADMINS=false
```
Add to `.env.staging.example` and `.env.production.example`:
```
REQUIRE_MFA_FOR_ADMINS=true
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace @bitpix/api`
Expected: PASS (only env additions).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/env.ts .env.example .env.development.example .env.staging.example .env.production.example
git commit -m "feat(api): REQUIRE_MFA_FOR_ADMINS env flag"
```

---

### Task 3: Step-up helper and admin-MFA policy

**Files:**
- Modify: `apps/api/src/modules/auth/mfa.service.ts` (add `assertStepUpMfa`)
- Modify: `apps/api/src/modules/auth/auth.guard.ts` (add `requiresMfa`)
- Test: `apps/api/tests/admin-user-management.spec.ts` (new; first test added here)

**Interfaces:**
- Produces: `assertStepUpMfa(request: FastifyRequest, code?: string): Promise<void>`; `requiresMfa(user: { isPlatformAdmin: boolean }, permissions: Iterable<string>): boolean`.
- Consumes: existing `authenticatedUser`, `readSecret`, `verifyTotp` in `mfa.service.ts`.

- [ ] **Step 1: Add `requiresMfa` to `auth.guard.ts`** (top-level export)

```ts
const ADMIN_PERMISSION_PREFIXES = ["users.", "roles."] as const;

export function requiresMfa(user: { isPlatformAdmin: boolean }, permissions: Iterable<string>): boolean {
  if (user.isPlatformAdmin) return true;
  for (const permission of permissions) {
    if (ADMIN_PERMISSION_PREFIXES.some((prefix) => permission.startsWith(prefix))) return true;
  }
  return false;
}
```

- [ ] **Step 2: Add `assertStepUpMfa` to `mfa.service.ts`** (uses existing helpers in that file)

```ts
export async function assertStepUpMfa(request: FastifyRequest, code?: string): Promise<void> {
  const user = await authenticatedUser(request);
  if (!user.mfaEnabled) throw new AppError(403, "MFA_SETUP_REQUIRED", "Ative o 2FA para executar esta ação.");
  if (!code) throw new AppError(428, "MFA_REQUIRED", "Informe o código do autenticador.");
  if (!verifyTotp(readSecret(user), code)) throw new AppError(401, "MFA_INVALID", "Código de autenticação inválido.");
}
```

- [ ] **Step 3: Create the test file with a `requiresMfa` unit test**

Create `apps/api/tests/admin-user-management.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { requiresMfa } from "../src/modules/auth/auth.guard.js";

describe("requiresMfa", () => {
  it("exige MFA para platform admin", () => {
    expect(requiresMfa({ isPlatformAdmin: true }, [])).toBe(true);
  });
  it("exige MFA para quem gerencia usuários ou funções", () => {
    expect(requiresMfa({ isPlatformAdmin: false }, ["sales.create", "users.manage"])).toBe(true);
    expect(requiresMfa({ isPlatformAdmin: false }, ["roles.read"])).toBe(true);
  });
  it("não exige MFA para operador padrão", () => {
    expect(requiresMfa({ isPlatformAdmin: false }, ["sales.create", "cash.session.open"])).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm run test --workspace @bitpix/api -- admin-user-management`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/mfa.service.ts apps/api/src/modules/auth/auth.guard.ts apps/api/tests/admin-user-management.spec.ts
git commit -m "feat(api): step-up MFA helper and admin-MFA policy"
```

---

### Task 4: Login enrollment-pending + principal flags

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (login, ~line 96-105 and principal build ~135-148)
- Modify: `apps/api/src/modules/auth/auth.guard.ts` (principal build ~55-72)
- Test: `apps/api/tests/admin-user-management.spec.ts`

**Interfaces:**
- Consumes: `requiresMfa` (Task 3), `env.REQUIRE_MFA_FOR_ADMINS` (Task 2), `SessionPrincipal` flags (Task 1).
- Produces: principal now includes `mfaEnrollmentPending` and `mustResetPassword` in both login and authenticate.

- [ ] **Step 1: Replace the platform-only MFA block in `login()`** (lines ~96-105)

```ts
  const permissionKeysForUser = user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key));
  const mustEnrollMfa = (env.REQUIRE_MFA_FOR_PLATFORM || env.REQUIRE_MFA_FOR_ADMINS)
    && requiresMfa(user, permissionKeysForUser)
    && !user.mfaEnabled;

  if (user.mfaEnabled) {
    if (!mfaCode && !recoveryCode) throw new AppError(428, "MFA_REQUIRED", "Informe o código do autenticador.");
    if (!await verifyMfaForLogin(user, mfaCode, recoveryCode)) {
      await writeAudit({ request, action: "auth.mfa.failed", entity: "User", entityPublicId: user.publicId, outcome: "FAILURE", companyId: user.companyId, branchId: user.branchId, userId: user.id });
      throw new AppError(401, "MFA_INVALID", "Código de autenticação inválido.");
    }
  }
```

Add the import at top of `auth.service.ts`:
```ts
import { requiresMfa } from "./auth.guard.js";
```

- [ ] **Step 2: Add flags to the principal in `login()`** (object at ~line 135)

```ts
    roles,
    permissions,
    sessionExpiresAt: session.expiresAt.toISOString(),
    mfaEnrollmentPending: mustEnrollMfa,
    mustResetPassword: user.mustResetPassword,
  };
```

- [ ] **Step 3: Add flags to the principal in `authenticate()`** (`auth.guard.ts`, object at ~line 55)

```ts
    roles,
    permissions: permissionList,
    sessionExpiresAt: session.expiresAt.toISOString(),
    mfaEnrollmentPending: (env.REQUIRE_MFA_FOR_PLATFORM || env.REQUIRE_MFA_FOR_ADMINS) && requiresMfa(session.user, permissionList) && !session.user.mfaEnabled,
    mustResetPassword: session.user.mustResetPassword,
  };
```

- [ ] **Step 4: Add integration test — admin without MFA gets enrollment-pending session**

Append to `admin-user-management.spec.ts`:

```ts
import { prisma } from "@bitpix/database";
import { afterAll, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@bitpix.local";
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

describe("matrícula de 2FA no login do admin", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    process.env.REQUIRE_MFA_FOR_ADMINS = "true";
    app = await buildApp();
    await app.ready();
    await prisma.user.update({ where: { normalizedEmail: adminEmail }, data: { mfaEnabled: false, mfaSecretCiphertext: null, mfaSecretIv: null, mfaSecretAuthTag: null } });
  });
  afterAll(async () => { await app.close(); });

  it("cria sessão pendente de matrícula para admin sem MFA", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: adminEmail, password: adminPassword } });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.mfaEnrollmentPending).toBe(true);
  });
});
```

> Note: `env` is parsed once at import. Set `process.env.REQUIRE_MFA_FOR_ADMINS` in `beforeAll` before `buildApp()`; because setup runs per file, this file controls the flag. If ordering causes a cached `env`, move this flag into `tests/setup-env.ts` guarded by a per-file marker — but prefer the local set first and verify.

- [ ] **Step 5: Run tests, then commit**

Run: `npm run test --workspace @bitpix/api -- admin-user-management`
Expected: enrollment-pending test passes.

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/auth.guard.ts apps/api/tests/admin-user-management.spec.ts
git commit -m "feat(api): grace enrollment session + principal 2FA/reset flags"
```

---

### Task 5: Enrollment + password-reset gates in `authenticate()`

**Files:**
- Modify: `apps/api/src/modules/auth/auth.guard.ts` (inside `authenticate`, after principal/`request.auth` set, before `lastSeenAt` update ~line 84)
- Test: `apps/api/tests/admin-user-management.spec.ts`

**Interfaces:**
- Consumes: principal flags (Task 4).
- Produces: protected routes throw `MFA_ENROLLMENT_REQUIRED` (403) / `PASSWORD_CHANGE_REQUIRED` (403) until resolved, except an allowlist.

- [ ] **Step 1: Add the gates in `authenticate()`** (after `request.auth = { ... }`)

```ts
  const path = request.url.split("?")[0];
  const enrollmentAllow = ["/api/v1/auth/mfa/setup", "/api/v1/auth/mfa/confirm", "/api/v1/auth/me", "/api/v1/auth/logout"];
  const resetAllow = ["/api/v1/auth/password/change", "/api/v1/auth/me", "/api/v1/auth/logout"];
  if (principal.mfaEnrollmentPending && !enrollmentAllow.includes(path)) {
    throw new AppError(403, "MFA_ENROLLMENT_REQUIRED", "Configure o 2FA para continuar.");
  }
  if (principal.mustResetPassword && !resetAllow.includes(path)) {
    throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Redefina sua senha para continuar.");
  }
```

Add `import { AppError } from "../../lib/errors.js";` if not already imported (it imports `forbidden, unauthorized` — add `AppError`).

- [ ] **Step 2: Test — pending admin is blocked on a normal route but allowed on `/auth/me`**

Append to the "matrícula" describe:

```ts
  it("bloqueia rota comum e libera /auth/me enquanto pende matrícula", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: adminEmail, password: adminPassword } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const blocked = await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("MFA_ENROLLMENT_REQUIRED");
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });
```

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace @bitpix/api -- admin-user-management`
Expected: PASS.

- [ ] **Step 4: Restore admin MFA state for other suites**

Append an `afterAll` step that re-enables nothing (admin stays without MFA in test DB is fine because other suites don't require MFA — `REQUIRE_MFA_FOR_ADMINS` defaults false there). Confirm by running the full suite in Step 5.

- [ ] **Step 5: Run full suite, then commit**

Run: `npm run test`
Expected: all pass (other suites unaffected because the flag is only set inside this file's `beforeAll`).

```bash
git add apps/api/src/modules/auth/auth.guard.ts apps/api/tests/admin-user-management.spec.ts
git commit -m "feat(api): enrollment and password-change gates in auth guard"
```

---

### Task 6: `POST /auth/password/change` (self-service)

**Files:**
- Modify: `apps/api/src/modules/auth/auth.routes.ts`
- Test: `apps/api/tests/admin-user-management.spec.ts`

**Interfaces:**
- Consumes: `changePasswordSchema` (Task 1), `authenticate`.
- Produces: `POST /api/v1/auth/password/change`.

- [ ] **Step 1: Add the route** (in `authRoutes`, after the reset route)

```ts
  app.post("/auth/password/change", { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    const auth = request.auth!;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!await argon2.verify(user.passwordHash, body.currentPassword)) throw new AppError(401, "PASSWORD_INVALID", "Senha atual inválida.");
    const passwordHash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustResetPassword: false } });
      await tx.userSession.updateMany({ where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeAudit({ request, client: tx, action: "auth.password.changed", entity: "User", entityPublicId: user.publicId });
    });
    return reply.status(204).send();
  });
```

Add imports: `import argon2 from "argon2";`, `import { AppError } from "../../lib/errors.js";`, and `changePasswordSchema` from `@bitpix/contracts`.

- [ ] **Step 2: Test**

Append a describe using the seed operator (has no admin perms, so no gates):

```ts
describe("troca de senha própria", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => {
    await prisma.user.update({ where: { normalizedEmail: "operador@bitpix.local" }, data: { passwordHash: (await import("argon2")).default ? undefined as never : undefined as never } }).catch(() => undefined);
    await app.close();
  });
  it("troca a senha com a senha atual correta", async () => {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "operador@bitpix.local", password: adminPassword } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const changed = await app.inject({ method: "POST", url: "/api/v1/auth/password/change", headers: { cookie }, payload: { currentPassword: adminPassword, newPassword: "NovaSenhaForte123" } });
    expect(changed.statusCode).toBe(204);
    // restaura a senha do seed para não quebrar outros testes
    const relogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "operador@bitpix.local", password: "NovaSenhaForte123" } });
    const cookie2 = String(relogin.headers["set-cookie"]).split(";")[0];
    await app.inject({ method: "POST", url: "/api/v1/auth/password/change", headers: { cookie: cookie2 }, payload: { currentPassword: "NovaSenhaForte123", newPassword: adminPassword! } });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace @bitpix/api -- admin-user-management`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/auth/auth.routes.ts apps/api/tests/admin-user-management.spec.ts
git commit -m "feat(api): self-service password change"
```

---

### Task 7: `POST /users/:id/set-password` (admin, step-up)

**Files:**
- Modify: `apps/api/src/modules/users/user.routes.ts`
- Test: `apps/api/tests/admin-user-management.spec.ts`

**Interfaces:**
- Consumes: `setPasswordSchema` (Task 1), `assertStepUpMfa` (Task 3).
- Produces: `POST /api/v1/users/:publicId/set-password`.

- [ ] **Step 1: Add the route** (in `userRoutes`)

```ts
  app.post<{ Params: { publicId: string } }>("/users/:publicId/set-password", { preHandler: requireAnyPermission("users.update", "users.manage") }, async (request, reply) => {
    const body = setPasswordSchema.parse(request.body);
    const auth = request.auth!;
    await assertStepUpMfa(request, body.mfaCode);
    const user = await prisma.user.findFirst({ where: { publicId: request.params.publicId, companyId: auth.companyId }, select: { id: true, publicId: true } });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
    if (user.id === auth.userId) throw new AppError(409, "SELF_PASSWORD_FORBIDDEN", "Use a troca de senha da sua própria conta.");
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustResetPassword: body.requirePasswordChange ?? false, failedLoginAttempts: 0, lockedUntil: null } });
      await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeAudit({ request, client: tx, action: "user.password.set", entity: "User", entityPublicId: user.publicId, metadata: { requirePasswordChange: body.requirePasswordChange ?? false } });
    });
    return reply.status(204).send();
  });
```

Add imports at top of `user.routes.ts`: `argon2` is already imported; add `setPasswordSchema, deleteUserSchema, resetMfaSchema` to the `@bitpix/contracts` import; add `import { assertStepUpMfa } from "../auth/mfa.service.js";`.

- [ ] **Step 2: Test — step-up required, then success revokes target sessions**

Append a describe that logs in as admin (enable MFA for admin first so step-up works). Add a helper to enroll admin MFA via the service and generate a code:

```ts
import { authenticator } from "otplib";
```
If `otplib` is not a dependency, generate the code from the stored secret using the project's `totp.ts`. Check `apps/api/src/modules/auth/totp.ts` for an exported `generateTotpSecret`/`verifyTotp`; add an exported `currentTotp(secret)` helper there if needed:

In `apps/api/src/modules/auth/totp.ts` ensure a helper exists to produce a code for tests:
```ts
export function currentTotp(secret: string): string { /* same algorithm as verifyTotp, current step */ }
```
(If `verifyTotp` already uses a library, reuse it to produce the code.)

Test:
```ts
describe("definir senha pelo admin (step-up)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie = "";
  let secret = "";
  beforeAll(async () => {
    process.env.REQUIRE_MFA_FOR_ADMINS = "false";
    app = await buildApp();
    await app.ready();
    // habilita MFA do admin diretamente para permitir step-up
    const { generateTotpSecret } = await import("../src/modules/auth/totp.js");
    const { encryptSecret } = await import("../src/lib/secret-vault.js");
    secret = generateTotpSecret();
    const admin = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: adminEmail } });
    const enc = encryptSecret(secret, `mfa:${admin.id}`);
    await prisma.user.update({ where: { id: admin.id }, data: { mfaEnabled: true, mfaConfirmedAt: new Date(), mfaSecretCiphertext: enc.ciphertext, mfaSecretIv: enc.iv, mfaSecretAuthTag: enc.authTag } });
    const { currentTotp } = await import("../src/modules/auth/totp.js");
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: adminEmail, password: adminPassword, mfaCode: currentTotp(secret) } });
    adminCookie = String(login.headers["set-cookie"]).split(";")[0];
  });
  afterAll(async () => {
    await prisma.user.update({ where: { normalizedEmail: adminEmail }, data: { mfaEnabled: false, mfaSecretCiphertext: null, mfaSecretIv: null, mfaSecretAuthTag: null } });
    await app.close();
  });

  it("recusa sem código de 2FA e aceita com código válido", async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: "operador@bitpix.local" }, select: { publicId: true } });
    const { currentTotp } = await import("../src/modules/auth/totp.js");
    const noCode = await app.inject({ method: "POST", url: `/api/v1/users/${target.publicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: "TempSenha123456", mfaCode: "000000" } });
    expect([401, 428]).toContain(noCode.statusCode);
    const ok = await app.inject({ method: "POST", url: `/api/v1/users/${target.publicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: "TempSenha123456", mfaCode: currentTotp(secret) } });
    expect(ok.statusCode).toBe(204);
    // restaura a senha do operador
    const t = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: "operador@bitpix.local" }, select: { publicId: true } });
    await app.inject({ method: "POST", url: `/api/v1/users/${t.publicId}/set-password`, headers: { cookie: adminCookie }, payload: { password: adminPassword!, mfaCode: currentTotp(secret) } });
  });
});
```

- [ ] **Step 3: Ensure `currentTotp` exists in `totp.ts`**

Open `apps/api/src/modules/auth/totp.ts`; if it wraps a library (e.g., `otplib`), export:
```ts
export function currentTotp(secret: string): string {
  return authenticator.generate(secret); // if otplib
}
```
If it is a hand-rolled HOTP/TOTP, expose the same generation the verify path compares against.

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace @bitpix/api -- admin-user-management`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/users/user.routes.ts apps/api/src/modules/auth/totp.ts apps/api/tests/admin-user-management.spec.ts
git commit -m "feat(api): admin set-password with step-up MFA"
```

---

### Task 8: `DELETE /users/:id` (hard when no history, else deactivate)

**Files:**
- Modify: `apps/api/src/modules/users/user.routes.ts`
- Test: `apps/api/tests/admin-user-management.spec.ts`

**Interfaces:**
- Consumes: `deleteUserSchema` (Task 1), `assertStepUpMfa` (Task 3).
- Produces: `DELETE /api/v1/users/:publicId` → `{ data: { deleted: boolean, deactivated: boolean } }`.

- [ ] **Step 1: Add the route**

```ts
  app.delete<{ Params: { publicId: string } }>("/users/:publicId", { preHandler: requireAnyPermission("users.disable", "users.manage") }, async (request) => {
    const body = deleteUserSchema.parse(request.body);
    const auth = request.auth!;
    await assertStepUpMfa(request, body.mfaCode);
    const user = await prisma.user.findFirst({ where: { publicId: request.params.publicId, companyId: auth.companyId }, select: { id: true, publicId: true, name: true, email: true } });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
    if (user.id === auth.userId) throw new AppError(409, "SELF_DELETE_FORBIDDEN", "Você não pode excluir a própria conta.");
    const [sales, sessions, movements, audits, providerConfigured, providerUpdated, exports] = await Promise.all([
      prisma.sale.count({ where: { operatorId: user.id } }),
      prisma.cashSession.count({ where: { operatorId: user.id } }),
      prisma.cashMovement.count({ where: { performedByUserId: user.id } }),
      prisma.auditLog.count({ where: { userId: user.id } }),
      prisma.providerConfiguration.count({ where: { configuredByUserId: user.id } }),
      prisma.providerConfiguration.count({ where: { updatedByUserId: user.id } }),
      prisma.exportJob.count({ where: { requestedByUserId: user.id } }),
    ]);
    const hasHistory = sales + sessions + movements + audits + providerConfigured + providerUpdated + exports > 0;
    if (hasHistory) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { status: "INACTIVE" } });
        await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await writeAudit({ request, client: tx, action: "user.deactivated", entity: "User", entityPublicId: user.publicId, metadata: { reason: "delete_with_history" } });
      });
      return { data: { deleted: false, deactivated: true } };
    }
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.userSession.deleteMany({ where: { userId: user.id } });
      await writeAudit({ request, client: tx, action: "user.deleted", entity: "User", entityPublicId: user.publicId, before: { name: user.name, email: user.email } });
      await tx.user.delete({ where: { id: user.id } });
    });
    return { data: { deleted: true, deactivated: false } };
  });
```

> Verify the exact relation field names against `schema.prisma` before writing: `CashMovement.performedByUserId`, `ExportJob.requestedByUserId`, `ProviderConfiguration.configuredByUserId/updatedByUserId`. Adjust the `where` keys to the real column names (grep `model CashMovement`, `model ExportJob`, `model ProviderConfiguration`).

- [ ] **Step 2: Test — create a throwaway user, delete hard; a user with history deactivates**

```ts
  it("exclui de vez um usuário sem histórico", async () => {
    const { currentTotp } = await import("../src/modules/auth/totp.js");
    const created = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie: adminCookie }, payload: { name: "Descartável", email: `descartavel-${Date.now()}@test.local`, password: "SenhaDescartavel1", roleKeys: ["OPERATOR"] } });
    expect(created.statusCode).toBe(201);
    const publicId = created.json().data.publicId;
    const removed = await app.inject({ method: "DELETE", url: `/api/v1/users/${publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: currentTotp(secret) } });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data.deleted).toBe(true);
  });

  it("bloqueia auto-exclusão", async () => {
    const { currentTotp } = await import("../src/modules/auth/totp.js");
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: adminCookie } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: adminEmail }, select: { publicId: true } });
    const selfDelete = await app.inject({ method: "DELETE", url: `/api/v1/users/${admin.publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: currentTotp(secret) } });
    expect(selfDelete.statusCode).toBe(409);
    expect(me.statusCode).toBe(200);
  });
```

(Place these `it` blocks inside the Task 7 describe so they reuse `adminCookie`/`secret`.)

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace @bitpix/api -- admin-user-management`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/users/user.routes.ts apps/api/tests/admin-user-management.spec.ts
git commit -m "feat(api): delete user (hard when no history, else deactivate) with step-up"
```

---

### Task 9: `POST /users/:id/reset-mfa` + `requirePasswordChange` on create

**Files:**
- Modify: `apps/api/src/modules/users/user.routes.ts`
- Test: `apps/api/tests/admin-user-management.spec.ts`

**Interfaces:**
- Consumes: `resetMfaSchema` (Task 1), `assertStepUpMfa`.
- Produces: `POST /api/v1/users/:publicId/reset-mfa`; `POST /users` honors `requirePasswordChange`.

- [ ] **Step 1: Honor `requirePasswordChange` in `POST /users`**

In the existing create handler, change the user creation `mustResetPassword: true` to:
```ts
mustResetPassword: body.requirePasswordChange ?? false,
```

- [ ] **Step 2: Add reset-mfa route**

```ts
  app.post<{ Params: { publicId: string } }>("/users/:publicId/reset-mfa", { preHandler: requireAnyPermission("users.update", "users.manage") }, async (request) => {
    const body = resetMfaSchema.parse(request.body);
    const auth = request.auth!;
    await assertStepUpMfa(request, body.mfaCode);
    const user = await prisma.user.findFirst({ where: { publicId: request.params.publicId, companyId: auth.companyId }, select: { id: true, publicId: true } });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
    if (user.id === auth.userId) throw new AppError(409, "SELF_MFA_RESET_FORBIDDEN", "Gerencie o próprio 2FA na tela de segurança.");
    await prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaConfirmedAt: null, mfaSecretCiphertext: null, mfaSecretIv: null, mfaSecretAuthTag: null } });
      await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeAudit({ request, client: tx, action: "user.mfa.reset", entity: "User", entityPublicId: user.publicId });
    });
    return { data: { reset: true } };
  });
```

- [ ] **Step 3: Test reset-mfa on a throwaway user with MFA set**

```ts
  it("zera o 2FA de um usuário", async () => {
    const { currentTotp } = await import("../src/modules/auth/totp.js");
    const { generateTotpSecret } = await import("../src/modules/auth/totp.js");
    const { encryptSecret } = await import("../src/lib/secret-vault.js");
    const created = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie: adminCookie }, payload: { name: "Com MFA", email: `commfa-${Date.now()}@test.local`, password: "SenhaComMfa12345", roleKeys: ["OPERATOR"] } });
    const publicId = created.json().data.publicId;
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { publicId } });
    const enc = encryptSecret(generateTotpSecret(), `mfa:${dbUser.id}`);
    await prisma.user.update({ where: { id: dbUser.id }, data: { mfaEnabled: true, mfaSecretCiphertext: enc.ciphertext, mfaSecretIv: enc.iv, mfaSecretAuthTag: enc.authTag } });
    const res = await app.inject({ method: "POST", url: `/api/v1/users/${publicId}/reset-mfa`, headers: { cookie: adminCookie }, payload: { mfaCode: currentTotp(secret) } });
    expect(res.statusCode).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { publicId } });
    expect(after.mfaEnabled).toBe(false);
    // limpeza
    await app.inject({ method: "DELETE", url: `/api/v1/users/${publicId}`, headers: { cookie: adminCookie }, payload: { mfaCode: currentTotp(secret) } });
  });
```

- [ ] **Step 4: Run tests, full suite, commit**

Run: `npm run test`
Expected: all pass.

```bash
git add apps/api/src/modules/users/user.routes.ts apps/api/tests/admin-user-management.spec.ts
git commit -m "feat(api): reset user MFA + honor requirePasswordChange on create"
```

---

### Task 10: Backend gates — lint, typecheck, full test

**Files:** none (verification task)

- [ ] **Step 1: Lint + typecheck + test + build**

Run: `npm run lint && npm run typecheck && npm run test && npm run build`
Expected: all green. Fix any type mismatch (e.g., principal fields) surfaced.

- [ ] **Step 2: Commit any fixups**

```bash
git add -A
git commit -m "chore(api): backend gates green for admin user mgmt + 2FA"
```

---

### Task 11: Frontend — MFA setup screen

**Files:**
- Create: `apps/web/src/features/auth/mfa-setup.tsx`
- Create/modify: a route under `apps/web/src/app/(protected)/configuracoes/seguranca/page.tsx`
- Reference: existing `session-actions.tsx` for style; endpoints `/auth/mfa/setup`, `/auth/mfa/confirm`, `/auth/mfa/disable`.

**Interfaces:**
- Consumes: API `POST /auth/mfa/setup` `{ password }` → `{ secret, otpauthUri, qrCodeDataUrl }`; `POST /auth/mfa/confirm` `{ code }` → `{ recoveryCodes }`; `POST /auth/mfa/disable` `{ password, code }`.

- [ ] **Step 1: Build the setup component**

Create `mfa-setup.tsx` (client component) with three stages: (1) confirm password → call setup, show `qrCodeDataUrl` + `otpauthUri`; (2) enter 6-digit code → call confirm, show recovery codes once; (3) enabled state with a "Desativar 2FA" form (password + code). Use `next/image` for the QR data URL, `field-input`/`primary-button` classes. Handle errors via the standard `{ error: { message } }` body.

```tsx
"use client";
import { useState } from "react";
import Image from "next/image";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
// ...three-stage state machine calling the three endpoints; render QR, code input, recovery codes...
```
(Write the full component following `mercado-pago-settings.tsx` patterns for fetch + notices.)

- [ ] **Step 2: Add the page**

Create `configuracoes/seguranca/page.tsx` that renders `<MfaSetup initialEnabled={...} />` — fetch current MFA state via `/auth/me` server-side (principal has no mfaEnabled today; expose it if needed by adding `mfaEnabled` to `/auth/me` response, or fetch a small `/auth/mfa/status`). Simplest: add `mfaEnabled` to the `SessionPrincipal` in Task 1 alternative — but to avoid scope creep, add a tiny `GET /auth/mfa/status` returning `{ enabled: boolean }` guarded by `authenticate`.

- [ ] **Step 3: Manual verify + build**

Run: `npm run build --workspace @bitpix/web`
Expected: PASS. Manually verify the flow against the running dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/auth/mfa-setup.tsx "apps/web/src/app/(protected)/configuracoes/seguranca/page.tsx" apps/api/src/modules/auth/auth.routes.ts
git commit -m "feat(web): MFA setup screen"
```

---

### Task 12: Frontend — expanded user manager with step-up modal

**Files:**
- Modify: `apps/web/src/features/admin/user-manager.tsx`
- Create: `apps/web/src/features/admin/step-up-modal.tsx`

**Interfaces:**
- Consumes: `POST /users` (with `requirePasswordChange`), `PATCH /users/:id`, `POST /users/:id/set-password`, `DELETE /users/:id`, `POST /users/:id/reset-mfa`, `POST /users/:id/revoke-sessions`.

- [ ] **Step 1: Step-up modal component**

Create `step-up-modal.tsx`: a controlled dialog that takes a title and an `onConfirm(code: string)` callback, renders a 6-digit input, disables submit until 6 digits, shows errors. Reuse `.history-modal`/`.card` styles.

- [ ] **Step 2: Expand `user-manager.tsx`**

Add row actions and modals: Edit (name/email/role/branch → `PATCH`), Set password (password + "exigir troca" checkbox → step-up → `set-password`), Reset 2FA (step-up → `reset-mfa`), Delete (confirm + step-up → `DELETE`, show whether it deleted or deactivated), plus existing activate/deactivate and revoke. Add the "exigir troca no 1º login" checkbox to the create form. Sensitive actions route through the step-up modal to collect the admin's TOTP code and pass it in the body.

- [ ] **Step 3: Build**

Run: `npm run build --workspace @bitpix/web && npm run lint --workspace @bitpix/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/admin/user-manager.tsx apps/web/src/features/admin/step-up-modal.tsx
git commit -m "feat(web): full admin user management with 2FA step-up"
```

---

### Task 13: Frontend — post-login gates and login MFA code

**Files:**
- Modify: `apps/web/src/features/auth/login-form.tsx`
- Modify: `apps/web/src/app/(protected)/layout.tsx` (or the protected shell) for gates

**Interfaces:**
- Consumes: principal flags `mfaEnrollmentPending`, `mustResetPassword`; login `428 MFA_REQUIRED`.

- [ ] **Step 1: Login MFA code field**

In `login-form.tsx`, when the login response is `428` with code `MFA_REQUIRED`, reveal a 6-digit code field (and a "usar código de recuperação" toggle) and resubmit with `mfaCode`/`recoveryCode`. Verify current behavior first (read the file); only add if missing.

- [ ] **Step 2: Post-login gates**

In the protected layout, read the principal (already loaded server-side for the shell). If `mfaEnrollmentPending`, redirect to `/configuracoes/seguranca`; if `mustResetPassword`, redirect to a change-password screen (create a minimal `configuracoes/senha` page calling `/auth/password/change`). Allow the target pages themselves to render.

- [ ] **Step 3: Build + lint + e2e**

Run: `npm run build && npm run lint && npm run test:e2e`
Expected: PASS (e2e admin journey unaffected; admin has no MFA required in dev where `REQUIRE_MFA_FOR_ADMINS=false`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): login MFA code + post-login enrollment/password gates"
```

---

### Task 14: Final gates + docs

- [ ] **Step 1: Full verification**

Run: `npm run lint && npm run typecheck && npm run test && npm run build && npm run test:e2e`
Expected: all green.

- [ ] **Step 2: Update README/SECURITY**

Document the new endpoints, the `REQUIRE_MFA_FOR_ADMINS` flag, the admin 2FA requirement, and the user-management capabilities in `README.md` and `SECURITY.md`.

- [ ] **Step 3: Commit**

```bash
git add README.md SECURITY.md
git commit -m "docs: admin user management + mandatory admin 2FA"
```

## Self-Review Notes

- **Spec coverage:** create/edit/set-password/delete/reset-mfa/revoke → Tasks 7-9, 12; admin 2FA login enforcement (Approach A) → Tasks 4-5; step-up → Tasks 3,7,8,9; MFA setup UI → Task 11; password-change flow → Task 6,13; delete semantics (hard/soft) → Task 8; no migration → confirmed (uses existing fields).
- **Verify-before-write callouts:** exact relation field names for the delete history check (Task 8 Step 1 note); existence/shape of `currentTotp` in `totp.ts` (Task 7 Step 3); whether `login-form.tsx` already handles `428` (Task 13 Step 1).
- **Type consistency:** `assertStepUpMfa(request, code?)`, `requiresMfa(user, permissions)`, principal flags `mfaEnrollmentPending`/`mustResetPassword` used consistently across tasks.
