# Caixa dedicado por dono + senha mínima de 6 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada usuário passa a ter um caixa dedicado (vínculo 1:1, só o dono abre sessão; admin com permissão especial faz override), e a senha mínima cai de 12 para 6 caracteres em todos os fluxos.

**Architecture:** Monorepo pnpm com `packages/contracts` (schemas Zod + tipos compartilhados), `packages/database` (Prisma), `apps/api` (Fastify) e `apps/web` (Next.js). O dono do caixa é uma coluna `ownerUserId` nullable em `CashRegister` com índice único (garante 1 caixa por usuário); a obrigatoriedade é aplicada na camada de API. Enforcement de abertura de sessão fica em `cash.routes.ts`.

**Tech Stack:** TypeScript, Zod, Prisma (PostgreSQL), Fastify, Vitest, Next.js/React.

## Global Constraints

- **Banco compartilhado com produção:** migrações são SQL aditivo escrito à mão em `packages/database/prisma/migrations/`. NÃO rodar `prisma migrate dev`. Colunas novas devem ser nullable. Testes usam tenants isolados e NUNCA tocam contas seed.
- **Senha mínima nova = 6 caracteres** em todos os fluxos de usuário, inclusive login. Máximo permanece 128.
- **Vínculo caixa↔dono = 1:1:** um caixa tem no máximo um dono; um usuário é dono de no máximo um caixa (índice único em `ownerUserId`).
- **Permissão de override:** `cash.session.open.any`.
- Comandos rodam a partir da raiz do repo. Testes da API: `pnpm --filter @bitpix/api test`.

---

### Task 1: Senha mínima de 6 caracteres

**Files:**
- Modify: `packages/contracts/src/index.ts` (linhas 81, 90, 111, 127, 142)
- Modify: `apps/api/src/modules/platform/platform.routes.ts:12`
- Modify: `apps/web/src/features/auth/password-change.tsx:52-53`
- Modify: `apps/web/src/features/admin/user-manager.tsx` (linhas 199, 268)
- Test: `apps/api/tests/password-min-length.spec.ts` (criar)

**Interfaces:**
- Consumes: nada.
- Produces: schemas `createUserSchema`, `changePasswordSchema`, `setPasswordSchema`, `resetPasswordSchema`, `loginSchema` passam a aceitar senha de 6 caracteres.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/tests/password-min-length.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  resetPasswordSchema,
  setPasswordSchema,
} from "@bitpix/contracts";

describe("senha mínima de 6 caracteres", () => {
  it("aceita senha de 6 caracteres em createUserSchema", () => {
    const result = createUserSchema.safeParse({
      name: "Fulano",
      email: "fulano@bitpix.test",
      password: "abc123",
      roleKeys: ["OPERADOR"],
    });
    expect(result.success).toBe(true);
  });

  it("rejeita senha de 5 caracteres em createUserSchema", () => {
    const result = createUserSchema.safeParse({
      name: "Fulano",
      email: "fulano@bitpix.test",
      password: "abc12",
      roleKeys: ["OPERADOR"],
    });
    expect(result.success).toBe(false);
  });

  it("aceita senha de 6 no login, troca, definição e reset", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "abc123" }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: "abc123", newPassword: "abc456" }).success).toBe(true);
    expect(setPasswordSchema.safeParse({ password: "abc123", mfaCode: "123456" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ token: "t".repeat(32), password: "abc123" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @bitpix/api test password-min-length`
Expected: FAIL (senha de 6 é rejeitada porque o mínimo ainda é 12/8).

- [ ] **Step 3: Baixar os mínimos nos contratos**

Em `packages/contracts/src/index.ts`, aplicar:
- Linha 81 (`loginSchema.password`): `z.string().min(8, "A senha deve ter ao menos 8 caracteres").max(128)` → `z.string().min(6, "A senha deve ter ao menos 6 caracteres").max(128)`
- Linha 90 (`resetPasswordSchema.password`): `z.string().min(12).max(128)` → `z.string().min(6).max(128)`
- Linha 111 (`createUserSchema.password`): `z.string().min(12).max(128)` → `z.string().min(6).max(128)`
- Linha 127 (`setPasswordSchema.password`): `z.string().min(12).max(128)` → `z.string().min(6).max(128)`
- Linha 142 (`changePasswordSchema.newPassword`): `z.string().min(12).max(128)` → `z.string().min(6).max(128)`

- [ ] **Step 4: Baixar o mínimo no cadastro de empresa**

Em `apps/api/src/modules/platform/platform.routes.ts:12`, no `companySchema`: `adminPassword: z.string().min(12).max(128)` → `adminPassword: z.string().min(6).max(128)`

- [ ] **Step 5: Ajustar o frontend**

Em `apps/web/src/features/auth/password-change.tsx`:
- Linha 52: `minLength={12}` → `minLength={6}`
- Linha 53: texto `Mínimo de 12 caracteres. As demais sessões serão encerradas.` → `Mínimo de 6 caracteres. As demais sessões serão encerradas.`

Em `apps/web/src/features/admin/user-manager.tsx`:
- Linha 199: `minLength={12}` → `minLength={6}`
- Linha 268: `minLength={12}` → `minLength={6}`

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @bitpix/api test password-min-length`
Expected: PASS (3 testes).

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/index.ts apps/api/src/modules/platform/platform.routes.ts apps/web/src/features/auth/password-change.tsx apps/web/src/features/admin/user-manager.tsx apps/api/tests/password-min-length.spec.ts
git commit -m "feat(auth): senha mínima de 6 caracteres"
```

---

### Task 2: Coluna ownerUserId no CashRegister (schema + migração)

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (model `CashRegister` ~l.480-499; model `User` ~l.307-337)
- Create: `packages/database/prisma/migrations/20260724000000_cash_register_owner/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `CashRegister.ownerUserId: String | null` (único) e relação `owner`/`ownedCashRegisters`. Cliente Prisma regenerado com esses campos.

- [ ] **Step 1: Adicionar a relação em `CashRegister`**

Em `packages/database/prisma/schema.prisma`, no `model CashRegister`, logo após a linha `description  String?  @db.VarChar(240)` adicionar:

```prisma
  ownerUserId  String?
```

E dentro do mesmo model, junto às relações (após `branch  Branch  @relation(...)`), adicionar:

```prisma
  owner        User?              @relation("CashRegisterOwner", fields: [ownerUserId], references: [id], onDelete: Restrict)
```

E ao final do bloco de índices do model (após `@@index([createdAt])`) adicionar:

```prisma
  @@unique([ownerUserId])
```

- [ ] **Step 2: Adicionar o lado inverso em `User`**

Em `model User`, junto às demais relações (após `closedCashSessions   CashSession[]  @relation("CashSessionCloser")`) adicionar:

```prisma
  ownedCashRegisters   CashRegister[]           @relation("CashRegisterOwner")
```

- [ ] **Step 3: Validar e formatar o schema**

Run: `pnpm --filter @bitpix/database exec prisma format`
Expected: schema formatado sem erros de validação.

- [ ] **Step 4: Escrever a migração SQL (aditiva, nullable)**

Criar `packages/database/prisma/migrations/20260724000000_cash_register_owner/migration.sql`:

```sql
-- Dono do caixa (vínculo 1:1). Coluna nullable e índice único: migração
-- aditiva/não destrutiva. Caixas existentes ficam sem dono até atribuição.
ALTER TABLE "CashRegister" ADD COLUMN "ownerUserId" TEXT;

CREATE UNIQUE INDEX "CashRegister_ownerUserId_key" ON "CashRegister"("ownerUserId");

ALTER TABLE "CashRegister"
  ADD CONSTRAINT "CashRegister_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 5: Regenerar o cliente Prisma**

Run: `pnpm --filter @bitpix/database generate`
Expected: cliente gerado sem erros; `CashRegister` passa a ter `ownerUserId`/`owner`.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260724000000_cash_register_owner/
git commit -m "feat(db): coluna ownerUserId (dono do caixa) com índice único"
```

---

### Task 3: Contratos — dono no caixa + permissão de override

**Files:**
- Modify: `packages/contracts/src/index.ts` (permissionKeys ~l.29; `cashRegisterCreateSchema` ~l.189; `cashRegisterUpdateSchema` ~l.196; `CashRegisterDto` ~l.363)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `permissionKeys` inclui `"cash.session.open.any"`.
  - `cashRegisterCreateSchema` exige `ownerUserPublicId: string (uuid)`.
  - `cashRegisterUpdateSchema` aceita `ownerUserPublicId?: string (uuid)`.
  - `CashRegisterDto.owner: { publicId: string; name: string } | null`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/tests/cash-register-contracts.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cashRegisterCreateSchema, permissionKeys } from "@bitpix/contracts";

describe("contratos do caixa com dono", () => {
  it("exige ownerUserPublicId na criação", () => {
    const semDono = cashRegisterCreateSchema.safeParse({
      branchPublicId: "11111111-1111-1111-1111-111111111111",
      name: "Caixa 1",
      code: "CX-1",
    });
    expect(semDono.success).toBe(false);
  });

  it("aceita criação com dono", () => {
    const comDono = cashRegisterCreateSchema.safeParse({
      branchPublicId: "11111111-1111-1111-1111-111111111111",
      name: "Caixa 1",
      code: "CX-1",
      ownerUserPublicId: "22222222-2222-2222-2222-222222222222",
    });
    expect(comDono.success).toBe(true);
  });

  it("expõe a permissão de override", () => {
    expect(permissionKeys).toContain("cash.session.open.any");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @bitpix/api test cash-register-contracts`
Expected: FAIL (schema aceita sem dono; permissão não existe).

- [ ] **Step 3: Adicionar a permissão em `permissionKeys`**

Em `packages/contracts/src/index.ts`, dentro de `permissionKeys`, após a linha `"cash.session.open",` (l.29) adicionar:

```ts
  "cash.session.open.any",
```

- [ ] **Step 4: Exigir dono na criação e permitir troca na atualização**

`cashRegisterCreateSchema` (l.189) passa a:

```ts
export const cashRegisterCreateSchema = z.object({
  branchPublicId: z.uuid(),
  name: z.string().trim().min(2, "Informe o nome do caixa").max(100),
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/, "Use letras, números, hífen ou sublinhado"),
  description: z.string().trim().max(240).nullable().optional(),
  ownerUserPublicId: z.uuid("Informe o dono do caixa"),
});
```

`cashRegisterUpdateSchema` (l.196) passa a:

```ts
export const cashRegisterUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/).optional(),
  description: z.string().trim().max(240).nullable().optional(),
  ownerUserPublicId: z.uuid().optional(),
}).refine((body) => Object.keys(body).length > 0, "Informe ao menos um campo");
```

- [ ] **Step 5: Adicionar `owner` ao `CashRegisterDto`**

`CashRegisterDto` (l.363) passa a incluir:

```ts
export interface CashRegisterDto {
  publicId: string;
  code: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "INACTIVE";
  branch: { publicId: string; code: string; name: string };
  owner: { publicId: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `pnpm --filter @bitpix/api test cash-register-contracts`
Expected: PASS (3 testes).

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/index.ts apps/api/tests/cash-register-contracts.spec.ts
git commit -m "feat(contracts): dono do caixa e permissão cash.session.open.any"
```

---

### Task 4: API — atribuir e trocar o dono do caixa

**Files:**
- Modify: `apps/api/src/modules/cash/cash.service.ts` (`cashRegisterSelect` ~l.12)
- Modify: `apps/api/src/modules/cash/cash.routes.ts` (`registerResponse` ~l.84; `POST /cash-registers` ~l.112; `PATCH /cash-registers/:publicId` ~l.177)
- Test: `apps/api/tests/cash-operations.spec.ts`

**Interfaces:**
- Consumes: `cashRegisterCreateSchema`/`cashRegisterUpdateSchema` com `ownerUserPublicId` (Task 3); `CashRegister.ownerUserId`/`owner` (Task 2).
- Produces:
  - `cashRegisterSelect` inclui `owner: { select: { publicId, name } }`.
  - `registerResponse` retorna `owner: { publicId, name } | null`.
  - Função `resolveOwner(request, ownerUserPublicId, branchId, excludeRegisterId?)` → retorna `{ id: string }` validando empresa, escopo de filial e unicidade. Erros: `409 CASH_REGISTER_OWNER_TAKEN`, `400 CASH_REGISTER_OWNER_INVALID`.

- [ ] **Step 1: Incluir `owner` no select do caixa**

Em `apps/api/src/modules/cash/cash.service.ts`, `cashRegisterSelect` (l.12) passa a:

```ts
export const cashRegisterSelect = {
  publicId: true,
  code: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  branch: { select: { publicId: true, code: true, name: true } },
  owner: { select: { publicId: true, name: true } },
} as const;
```

- [ ] **Step 2: Escrever os testes que falham**

Em `apps/api/tests/cash-operations.spec.ts`, adicionar (dentro do `describe`, após o teste "cadastra um caixa dentro da filial acessível" para reaproveitar `registerPublicId`) testes que dependem do dono. Primeiro, no `beforeAll`, criar um usuário dono e capturar `ownerPublicId` e um token. Adicionar após a criação do `deniedUser` (l.100):

```ts
    const ownerUser = await prisma.user.create({
      data: {
        companyId,
        branchId,
        name: "Dono do Caixa",
        email: `cash-owner-${suffix}@bitpix.test`,
        normalizedEmail: `cash-owner-${suffix}@bitpix.test`,
        passwordHash: "not-used",
      },
    });
    ownerUserPublicId = ownerUser.publicId;
```

E declarar no topo do describe (junto às outras `let`): `let ownerUserPublicId = "";`.

Ainda no `beforeAll`, o `foreignRegister` (l.109) precisa de dono próprio da empresa externa — criar um usuário externo e usá-lo:

```ts
    const foreignOwner = await prisma.user.create({
      data: {
        companyId: foreignCompany.id,
        branchId: foreignBranch.id,
        name: "Dono Externo",
        email: `cash-foreign-owner-${suffix}@bitpix.test`,
        normalizedEmail: `cash-foreign-owner-${suffix}@bitpix.test`,
        passwordHash: "not-used",
      },
    });
    const foreignRegister = await prisma.cashRegister.create({
      data: { companyId: foreignCompany.id, branchId: foreignBranch.id, code: "EXT-01", name: "Caixa externo", ownerUserId: foreignOwner.id },
    });
```

Substituir o teste "cadastra um caixa dentro da filial acessível" (l.134) para incluir o dono e validar o retorno:

```ts
  it("cadastra um caixa com dono dentro da filial acessível", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-registers",
      headers: { cookie: adminCookie },
      payload: { branchPublicId, code: "CX-TESTE", name: "Caixa de testes", description: "Integração", ownerUserPublicId },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.owner).toMatchObject({ publicId: ownerUserPublicId, name: "Dono do Caixa" });
    registerPublicId = response.json().data.publicId;
  });

  it("recusa cadastro de segundo caixa para o mesmo dono", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-registers",
      headers: { cookie: adminCookie },
      payload: { branchPublicId, code: "CX-DUP-OWNER", name: "Outro", ownerUserPublicId },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "CASH_REGISTER_OWNER_TAKEN" } });
  });
```

> Os demais testes que criam caixas (`CX-SECOND` l.156, `cx-teste` duplicado l.150) precisam de um dono. Para o duplicado de código (l.150) o dono nem chega a ser validado se a checagem de código vier antes — para manter o teste focado em código, passar `ownerUserPublicId` de um segundo usuário. Criar no `beforeAll` mais dois usuários donos (`secondOwnerPublicId`, `thirdOwnerPublicId`) e usá-los nesses payloads. Ver Task 6 para o ajuste completo desses testes.

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `pnpm --filter @bitpix/api test cash-operations`
Expected: FAIL (a rota ainda ignora `ownerUserPublicId`; `owner` vem indefinido e `CASH_REGISTER_OWNER_TAKEN` não existe).

- [ ] **Step 4: Adicionar helper `resolveOwner` e ajustar `registerResponse`**

Em `apps/api/src/modules/cash/cash.routes.ts`, ajustar a assinatura de `registerResponse` (l.84) para incluir `owner`:

```ts
function registerResponse(register: {
  publicId: string;
  code: string;
  name: string;
  description: string | null;
  status: CashRegisterStatus;
  createdAt: Date;
  updatedAt: Date;
  branch: { publicId: string; code: string; name: string };
  owner: { publicId: string; name: string } | null;
}) {
  return {
    ...register,
    createdAt: register.createdAt.toISOString(),
    updatedAt: register.updatedAt.toISOString(),
  };
}
```

Adicionar o helper (após `findScopedRegister`, ~l.54):

```ts
async function resolveOwner(
  request: FastifyRequest,
  ownerUserPublicId: string,
  branchId: string,
  excludeRegisterId?: string,
): Promise<{ id: string }> {
  const auth = request.auth!;
  const owner = await prisma.user.findFirst({
    where: {
      publicId: ownerUserPublicId,
      companyId: auth.companyId,
      status: "ACTIVE",
      OR: [{ branchId: null }, { branchId }],
    },
    select: { id: true },
  });
  if (!owner) {
    throw new AppError(400, "CASH_REGISTER_OWNER_INVALID", "O usuário informado não pode ser dono deste caixa.");
  }
  const existing = await prisma.cashRegister.findFirst({
    where: { ownerUserId: owner.id, ...(excludeRegisterId ? { id: { not: excludeRegisterId } } : {}) },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(409, "CASH_REGISTER_OWNER_TAKEN", "Este usuário já é dono de outro caixa.");
  }
  return owner;
}
```

- [ ] **Step 5: Gravar o dono na criação**

No `POST /cash-registers` (l.112), após validar `branch` e antes do `prisma.$transaction`, resolver o dono e incluí-lo no `create`:

```ts
    const owner = await resolveOwner(request, body.ownerUserPublicId, branch.id);

    try {
      const register = await prisma.$transaction(async (tx) => {
        const created = await tx.cashRegister.create({
          data: {
            companyId: auth.companyId,
            branchId: branch.id,
            code: body.code.toUpperCase(),
            name: body.name,
            description: body.description || null,
            ownerUserId: owner.id,
          },
          select: cashRegisterSelect,
        });
```

Incluir o dono na auditoria `after`:

```ts
          after: { code: created.code, name: created.name, status: created.status, ownerUserPublicId: created.owner?.publicId ?? null },
```

- [ ] **Step 6: Permitir troca de dono na atualização**

No `PATCH /cash-registers/:publicId` (l.177), após carregar `register` e antes do `$transaction`, resolver o novo dono se informado:

```ts
      const owner = body.ownerUserPublicId
        ? await resolveOwner(request, body.ownerUserPublicId, register.branchId, register.id)
        : null;
```

E no `tx.cashRegister.update` `data`, adicionar:

```ts
              ...(owner ? { ownerUserId: owner.id } : {}),
```

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `pnpm --filter @bitpix/api test cash-operations`
Expected: os testes de criação com dono e de dono duplicado passam. (Outros testes deste arquivo ainda podem falhar por dependerem da abertura por dono — corrigidos nas Tasks 5 e 7.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/cash/cash.service.ts apps/api/src/modules/cash/cash.routes.ts apps/api/tests/cash-operations.spec.ts
git commit -m "feat(cash): atribuir e trocar o dono do caixa"
```

---

### Task 5: API — enforcement de abertura por dono + override + seed

**Files:**
- Modify: `apps/api/src/modules/cash/cash.routes.ts` (`POST /cash-sessions/open` ~l.265)
- Modify: `packages/database/prisma/seed.ts` (catálogo de permissões ~l.32; permissões do admin ~l.176)
- Test: `apps/api/tests/cash-operations.spec.ts`

**Interfaces:**
- Consumes: `register.ownerUserId` (Task 2); permissão `cash.session.open.any` (Task 3).
- Produces: abertura de sessão bloqueada para não-donos (`403 CASH_REGISTER_NOT_OWNER`) exceto com `cash.session.open.any`, que gera auditoria `cash.session.opened.override`.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/tests/cash-operations.spec.ts`, adicionar um usuário dono com token de sessão para abrir o próprio caixa e um teste de bloqueio. No `beforeAll`, criar sessão para `ownerUser` (reusar `ownerUser` da Task 4) e um papel com `cash.session.open` mas SEM `cash.session.open.any`. Detalhe completo na Task 6; os testes-alvo:

```ts
  it("permite o dono abrir o próprio caixa", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: ownerCookie },
      payload: { cashRegisterPublicId: registerPublicId, openingBalanceInCents: 5000 },
    });
    expect(response.statusCode).toBe(201);
    // fecha para não interferir nos próximos testes
    await app.inject({
      method: "POST",
      url: `/api/v1/cash-sessions/${response.json().data.publicId}/close`,
      headers: { cookie: ownerCookie },
      payload: { countedBalanceInCents: 5000, note: null, confirmed: true },
    });
  });

  it("bloqueia não-dono sem permissão de override", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: plainOperatorCookie },
      payload: { cashRegisterPublicId: registerPublicId, openingBalanceInCents: 0 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "CASH_REGISTER_NOT_OWNER" } });
  });

  it("permite admin com override abrir caixa de outro dono e audita", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash-sessions/open",
      headers: { cookie: adminCookie },
      payload: { cashRegisterPublicId: registerPublicId, openingBalanceInCents: 0 },
    });
    expect(response.statusCode).toBe(201);
    const audit = await prisma.auditLog.findFirst({ where: { companyId, action: "cash.session.opened.override" } });
    expect(audit).not.toBeNull();
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @bitpix/api test cash-operations`
Expected: FAIL (hoje qualquer operador com `cash.session.open` abre qualquer caixa; não há 403 nem auditoria de override).

- [ ] **Step 3: Aplicar o enforcement na abertura**

Em `apps/api/src/modules/cash/cash.routes.ts`, no `POST /cash-sessions/open` (l.265), após obter `register` via `findScopedRegister` e antes da checagem de status inativo, adicionar:

```ts
    const isOwner = register.ownerUserId === auth.userId;
    const canOverride = auth.permissions.has("cash.session.open.any");
    if (!isOwner && !canOverride) {
      await writeAudit({
        request,
        action: "cash.session.open.denied.not_owner",
        entity: "CashRegister",
        entityPublicId: register.publicId,
        outcome: AuditOutcome.FAILURE,
        metadata: { ownerUserId: register.ownerUserId },
      });
      throw new AppError(403, "CASH_REGISTER_NOT_OWNER", "Este caixa pertence a outro usuário.");
    }
```

> `findScopedRegister` faz `include: { branch: true }`; garantir que `ownerUserId` está disponível no objeto (é escalar do próprio `cashRegister`, então já vem). Nenhuma mudança no include é necessária.

Dentro do `$transaction`, ao registrar a auditoria de abertura (`action: "cash.session.opened"`, l.312), quando for override registrar também o evento específico. Logo após o `writeAudit` de `cash.session.opened` existente, adicionar:

```ts
        if (!isOwner) {
          await writeAudit({
            request,
            client: tx,
            action: "cash.session.opened.override",
            entity: "CashSession",
            entityPublicId: created.publicId,
            branchId: register.branchId,
            metadata: { ownerUserId: register.ownerUserId, openedByUserId: auth.userId },
          });
        }
```

- [ ] **Step 4: Adicionar a permissão ao seed**

Em `packages/database/prisma/seed.ts`, no array do catálogo de permissões, após a linha `["cash.session.open", "Abrir caixa", "Iniciar uma sessão operacional de caixa"],` (l.32) adicionar:

```ts
  ["cash.session.open.any", "Abrir caixa de outro dono", "Override administrativo para abrir caixa que pertence a outro usuário"],
```

E na lista de permissões atribuídas ao papel admin (array que contém `"cash.session.open"`, l.176), adicionar após ela:

```ts
    "cash.session.open.any",
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @bitpix/api test cash-operations`
Expected: os três testes de enforcement passam.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/cash/cash.routes.ts packages/database/prisma/seed.ts apps/api/tests/cash-operations.spec.ts
git commit -m "feat(cash): abertura de sessão restrita ao dono com override auditado"
```

---

### Task 6: Ajuste completo dos testes de caixa existentes

**Files:**
- Modify: `apps/api/tests/cash-operations.spec.ts`

**Interfaces:**
- Consumes: rotas e regras das Tasks 4 e 5.
- Produces: suíte `cash-operations` verde de ponta a ponta.

- [ ] **Step 1: Preparar donos e tokens no `beforeAll`**

Garantir no `beforeAll` a criação de:
- `ownerUser` (+ `ownerUserPublicId`) e sua `userSession` (`ownerToken`/`ownerCookie`), com papel que tenha `cash.session.open` e `cash.session.close` (pode reusar o papel `CASH_TESTER`, mas SEM `cash.session.open.any`).
- `plainOperator` (+ `plainOperatorCookie`) com papel que tenha `cash.session.open` mas não seja dono de nenhum caixa e não tenha `cash.session.open.any`.
- `secondOwner`, `thirdOwner` (+ publicIds) para os caixas auxiliares (`CX-SECOND`, e o dono do payload do teste de código duplicado).
- O papel do `admin` deve incluir `cash.session.open.any` (ajustar o filtro em l.56-57 para NÃO remover essa permissão do admin; hoje só remove `cash.movement.withdrawal.override`).

Exemplo de bloco (inserir junto aos outros usuários no `beforeAll`):

```ts
    const openOnlyRole = await prisma.role.create({
      data: { companyId, key: "CASH_OPEN_ONLY", name: "Operador dono" },
    });
    const openPerm = await prisma.permission.findUniqueOrThrow({ where: { key: "cash.session.open" } });
    const closePerm = await prisma.permission.findUniqueOrThrow({ where: { key: "cash.session.close" } });
    const readPerm = await prisma.permission.findUniqueOrThrow({ where: { key: "cash.session.read" } });
    await prisma.rolePermission.createMany({
      data: [openPerm, closePerm, readPerm].map((permission) => ({ companyId, roleId: openOnlyRole.id, permissionId: permission.id })),
    });
    await prisma.userRole.create({ data: { companyId, userId: ownerUser.id, roleId: openOnlyRole.id } });
    const ownerToken = `cash-owner-${randomUUID()}`;
    await prisma.userSession.create({ data: { companyId, userId: ownerUser.id, tokenHash: hashSessionToken(ownerToken), expiresAt: new Date(Date.now() + 3_600_000) } });

    const plainOperator = await prisma.user.create({
      data: { companyId, branchId, name: "Operador Sem Caixa", email: `cash-plain-${suffix}@bitpix.test`, normalizedEmail: `cash-plain-${suffix}@bitpix.test`, passwordHash: "not-used" },
    });
    await prisma.userRole.create({ data: { companyId, userId: plainOperator.id, roleId: openOnlyRole.id } });
    const plainOperatorToken = `cash-plain-${randomUUID()}`;
    await prisma.userSession.create({ data: { companyId, userId: plainOperator.id, tokenHash: hashSessionToken(plainOperatorToken), expiresAt: new Date(Date.now() + 3_600_000) } });
```

Declarar no topo do describe: `const ownerCookie = ...; const plainOperatorCookie = ...;` (montados a partir de `cookieName`), além dos `let secondOwnerPublicId`, `thirdOwnerPublicId` e a criação dos dois usuários donos auxiliares.

- [ ] **Step 2: Passar dono nos payloads de criação de caixa auxiliares**

- Teste "impede código duplicado" (l.145): payload ganha `ownerUserPublicId: secondOwnerPublicId`.
- Teste "prepara um segundo caixa" (l.156): payload ganha `ownerUserPublicId: secondOwnerPublicId` (ou `thirdOwnerPublicId`, respeitando 1:1 — cada caixa criado com sucesso precisa de dono distinto).
- Caixas criados direto via `prisma.cashRegister.create` nos testes (ex.: `CX-OFF` inativo l.168) recebem `ownerUserId` de um dono livre (ex.: `thirdOwner`).

- [ ] **Step 3: Ajustar a asserção de ações de auditoria**

O teste que compara o conjunto de ações de auditoria (l.344-347) deve incluir `cash.session.opened.override` no `Set` esperado se algum fluxo de override rodar antes dele, ou usar `expect(...).toEqual(expect.arrayContaining([...]))` para não quebrar com a nova ação. Ajustar para:

```ts
    expect(new Set(actions.map(({ action }) => action))).toEqual(
      new Set(["cash.register.created", "cash.session.opened", "cash.movement.supplied", "cash.movement.withdrawn", "cash.session.closed", "cash.movement.denied.closed"]),
    );
```
Se o fluxo principal for aberto pelo dono (sem override), esse `Set` permanece válido. Garantir que o teste de override roda em bloco isolado que não polua esta asserção (usar caixa/dono dedicados ou limpar a asserção com `arrayContaining`).

- [ ] **Step 4: Limpeza no `afterAll`**

O `afterAll` já apaga por `companyId` em ordem segura (`cashRegister` antes de `user`? — hoje apaga `cashRegister` na l.122 e `user` na l.127, ordem correta pois o FK é `RESTRICT` de CashRegister→User). Confirmar que `cashRegister.deleteMany` vem ANTES de `user.deleteMany` (já vem). Nenhuma mudança necessária além de garantir que novos usuários estão sob o mesmo `companyId`.

- [ ] **Step 5: Rodar a suíte inteira e confirmar verde**

Run: `pnpm --filter @bitpix/api test cash-operations`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 6: Commit**

```bash
git add apps/api/tests/cash-operations.spec.ts
git commit -m "test(cash): adequar suíte de caixa ao vínculo dono 1:1"
```

---

### Task 7: Frontend — seletor de dono, exibição e label de auditoria

**Files:**
- Modify: `apps/web/src/app/(protected)/caixa/page.tsx`
- Modify: `apps/web/src/features/cash/cash-console.tsx`
- Modify: `apps/web/src/features/audit/audit-labels.ts`

**Interfaces:**
- Consumes: `CashRegisterDto.owner` (Task 3); `POST/PATCH /cash-registers` com `ownerUserPublicId` (Task 4).
- Produces: formulário de novo caixa com seletor de dono; listagem exibindo o dono; label de auditoria para override.

- [ ] **Step 1: Carregar usuários na página do caixa**

Em `apps/web/src/app/(protected)/caixa/page.tsx`, adicionar uma interface e buscar usuários quando o principal puder listar:

```ts
interface UserOption {
  publicId: string;
  name: string;
}
```

Após o bloco `Promise.all` (l.32-36), adicionar:

```ts
  const canPickOwner = principal.permissions.includes("users.read") || principal.permissions.includes("users.manage");
  const owners = canPickOwner
    ? (await apiFetch<PaginatedDto<UserOption>>("/users?pageSize=200")).data.map((u) => ({ publicId: u.publicId, name: u.name }))
    : [];
```

Passar ao console via nova prop:

```tsx
      <CashConsole
        initialRegisters={registers}
        initialSession={currentSession}
        initialMovements={movements}
        branches={branches}
        owners={owners}
        permissions={principal.permissions}
      />
```

> `apiFetch` de `/users` retorna `PaginatedDto`; o tipo `UserOption` é um subconjunto tolerante do usuário (só precisamos de `publicId`/`name`).

- [ ] **Step 2: Aceitar `owners` e o seletor no console**

Em `apps/web/src/features/cash/cash-console.tsx`:

Adicionar à interface `CashConsoleProps` (l.33):

```ts
  owners: { publicId: string; name: string }[];
```

Adicionar `owners` aos parâmetros desestruturados (l.91-97) e um estado para o dono selecionado (junto aos outros `useState`, ~l.124):

```ts
  const [registerOwner, setRegisterOwner] = useState(owners[0]?.publicId ?? "");
```

No `createRegister` (l.242), incluir `ownerUserPublicId` no corpo:

```ts
        body: JSON.stringify({
          branchPublicId: registerBranch,
          name: registerName,
          code: registerCode,
          description: registerDescription || null,
          ownerUserPublicId: registerOwner,
        }),
```

No formulário de novo caixa (l.440-446), adicionar o campo de dono (antes do botão de submit) e desabilitar o submit sem dono:

```tsx
            <div><label className="field-label" htmlFor="register-owner">Dono do caixa</label><select className="field-input" id="register-owner" required value={registerOwner} onChange={(event) => setRegisterOwner(event.target.value)}><option value="">Selecione o dono</option>{owners.map((owner) => <option value={owner.publicId} key={owner.publicId}>{owner.name}</option>)}</select></div>
            <button className="primary-button" type="submit" disabled={busy || !registerOwner}>Cadastrar caixa</button>
```

(substituindo o `<button ...>Cadastrar caixa</button>` existente na l.445).

- [ ] **Step 3: Exibir o dono na listagem de caixas**

No card de cada caixa (l.449), incluir o dono no bloco de descrição. Trocar o `<small>{register.code} · {register.branch.name}</small>` por:

```tsx
<small>{register.code} · {register.branch.name}{register.owner ? ` · Dono: ${register.owner.name}` : " · Sem dono"}</small>
```

- [ ] **Step 4: Adicionar label de auditoria do override**

Em `apps/web/src/features/audit/audit-labels.ts`, junto às entradas de caixa (após `"cash.session.opened": "Caixa aberto",`), adicionar:

```ts
  "cash.session.opened.override": "Caixa aberto (override admin)",
  "cash.session.open.denied.not_owner": "Abertura negada (não é o dono)",
```

- [ ] **Step 5: Verificar tipos e build do web**

Run: `pnpm --filter @bitpix/web typecheck`
Expected: sem erros de tipo (a prop `owners` é obrigatória e está sendo passada; `CashRegisterDto.owner` existe).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/(protected)/caixa/page.tsx apps/web/src/features/cash/cash-console.tsx apps/web/src/features/audit/audit-labels.ts
git commit -m "feat(web): seletor de dono do caixa e labels de auditoria"
```

---

### Task 8: Verificação final

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte da API**

Run: `pnpm --filter @bitpix/api test`
Expected: PASS (incluindo `password-min-length`, `cash-register-contracts`, `cash-operations`). Investigar qualquer outra spec que crie caixa sem dono e ajustá-la com o mesmo padrão da Task 6.

- [ ] **Step 2: Typecheck geral**

Run: `pnpm --filter @bitpix/contracts build && pnpm --filter @bitpix/api typecheck && pnpm --filter @bitpix/web typecheck`
Expected: sem erros.

- [ ] **Step 3: Confirmar que nenhuma outra spec cria caixa sem dono**

Run: `git grep -n "cash-registers" apps/api/tests`
Expected: revisar cada uso; todos os POST de criação incluem `ownerUserPublicId`.

- [ ] **Step 4: Commit final (se houve ajustes)**

```bash
git add -A
git commit -m "test: ajustes finais do vínculo caixa-dono"
```

## Notas de implantação (fora do plano automatizado)

- A migração `20260724000000_cash_register_owner` deve ser aplicada com `prisma migrate deploy` de forma controlada (banco compartilhado com produção). Caixas existentes ficam sem dono e só abrem via override até receberem um dono pela tela de caixa.
- Rodar o `seed` (ou um update pontual) para registrar a permissão `cash.session.open.any` e atribuí-la ao papel admin nos tenants existentes.
