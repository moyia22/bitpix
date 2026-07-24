# Caixa dedicado por dono + senha mínima de 6

Data: 2026-07-24

## Objetivo

1. **Caixa único por usuário**: cada `CashRegister` passa a ter um usuário "dono". Vínculo 1:1 — um caixa tem exatamente um dono, e um usuário pode ser dono de no máximo um caixa. Apenas o dono abre sessão no seu caixa; um admin com permissão especial pode abrir no lugar dele (override).
2. **Senha mínima de 6 caracteres**: reduzir o mínimo de 12 (e do login, hoje 8) para 6 em todos os fluxos de usuário.

## Parte 1 — Senha mínima de 6

Trocar o mínimo para `min(6)` de forma consistente.

### Backend — `packages/contracts/src/index.ts`
- `loginSchema.password` (l.81): `min(8)` → `min(6)`; ajustar mensagem para "ao menos 6 caracteres".
- `createUserSchema.password` (l.111): `min(12)` → `min(6)`.
- `setPasswordSchema.password` (l.127): `min(12)` → `min(6)`.
- `changePasswordSchema.newPassword` (l.142): `min(12)` → `min(6)`.
- `resetPasswordSchema.password` (l.90): `min(12)` → `min(6)`.

### Backend — `apps/api/src/modules/platform/platform.routes.ts`
- `companySchema.adminPassword` (l.12): `min(12)` → `min(6)`.

### Frontend
- `apps/web/src/features/auth/password-change.tsx` (l.52-53): `minLength={12}` → `6` e texto "Mínimo de 12 caracteres" → "Mínimo de 6 caracteres".
- `apps/web/src/features/admin/user-manager.tsx` (l.199 e l.268): `minLength={12}` → `6`.

### Fora de escopo
- `packages/database/prisma/seed.ts` (guard do `SEED_ADMIN_PASSWORD`, 12): permanece — é infra de seed, não afeta usuários finais.
- `packages/database/prisma/create-user.ts` (já usa 8): permanece.

## Parte 2 — Caixa dedicado por dono (1:1)

### Modelo de dados — `packages/database/prisma/schema.prisma`
Adicionar a `CashRegister`:
```prisma
ownerUserId String? @unique
owner       User?   @relation("CashRegisterOwner", fields: [ownerUserId], references: [id], onDelete: Restrict)
```
E em `User`: `ownedCashRegisters CashRegister[] @relation("CashRegisterOwner")` (mesmo sendo 1:1, o Prisma modela o lado do usuário como lista; a unicidade garante no máximo 1).

- `ownerUserId` é **nullable no banco** para migração segura no Supabase compartilhado com produção — caixas existentes ficam com `ownerUserId = NULL`.
- `@unique` em `ownerUserId` garante "1 caixa por usuário". O Postgres permite múltiplos NULL, então caixas legados sem dono coexistem sem violar a constraint.
- "Dono obrigatório" é aplicado na **camada de API** (schema de criação exige o dono), não como `NOT NULL` no banco.

### Contratos — `packages/contracts/src/index.ts`
- `cashRegisterCreateSchema`: adicionar `ownerUserPublicId: z.uuid()` (obrigatório).
- `cashRegisterUpdateSchema`: adicionar `ownerUserPublicId: z.uuid().optional()` (trocar o dono).
- `permissionKeys`: adicionar `"cash.session.open.any"` (override de admin).

### Rotas — `apps/api/src/modules/cash/cash.routes.ts`

**Criar caixa (`POST /cash-registers`)**
- Resolver `ownerUserPublicId` → usuário da empresa, ativo, dentro do escopo de filial (usuário com `branchId = null` é aceito; caso tenha filial, deve bater com a do caixa).
- Se o usuário já é dono de outro caixa, retornar `409 CASH_REGISTER_OWNER_TAKEN` ("Este usuário já é dono de outro caixa.") em vez do erro cru de constraint.
- Gravar `ownerUserId` no create; auditoria inclui o dono.

**Atualizar caixa (`PATCH /cash-registers/:publicId`)**
- Se `ownerUserPublicId` presente, aplicar as mesmas validações e trocar o dono (auditar before/after).

**Abrir sessão (`POST /cash-sessions/open`)**
- Buscar o caixa (já faz via `findScopedRegister`).
- Se `register.ownerUserId !== auth.userId`:
  - Exigir permissão `cash.session.open.any`. Se não tiver, `403 CASH_REGISTER_NOT_OWNER` ("Este caixa pertence a outro usuário.").
  - Se tiver, permitir e **gravar auditoria de override** (`cash.session.opened.override`).
- Se `register.ownerUserId === null`: tratar como "sem dono" → só abre com `cash.session.open.any` (mesmo caminho de override). Isso cobre os caixas legados.
- **Operador da sessão**: continua sendo `auth.userId` (o próprio admin no caso de override). Nenhuma mudança nas regras existentes de "uma sessão aberta por caixa" e "uma por operador".

### Seed — `packages/database/prisma/seed.ts`
- Adicionar `["cash.session.open.any", "Abrir caixa de outro operador", "Override administrativo para abrir caixa que pertence a outro usuário"]` ao catálogo de permissões.
- Atribuir `cash.session.open.any` ao papel admin.

### Frontend — `apps/web/src/features/cash/cash-console.tsx`
- Formulário de criar/editar caixa ganha um seletor de **dono** (lista de usuários da empresa, via endpoint de usuários existente).
- Exibir o dono na listagem de caixas.
- Caixas sem dono: indicar visualmente ("sem dono — atribua um dono para permitir abertura").

### Auditoria / labels — `apps/web/src/features/audit/audit-labels.ts`
- Adicionar label para `cash.session.opened.override` ("Caixa aberto (override admin)").

## Migração / compatibilidade
- Caixas existentes ficam sem dono e **não abrem sessão** por operadores comuns até um admin atribuir um dono (via edição) — ou usar o override.
- Migração Prisma: apenas adiciona coluna nullable + índice único. Segura para rodar em banco com dados.

## Testes
- Atualizar `apps/api/tests/cash-operations.spec.ts`:
  - Criar caixa agora exige dono.
  - Dono abre sessão no próprio caixa (sucesso).
  - Não-dono sem `cash.session.open.any` recebe 403.
  - Admin com `cash.session.open.any` abre e gera auditoria de override.
  - Não é possível cadastrar dois caixas com o mesmo dono (409).
- Testes usam helper de tenant isolado (`tests/helpers/tenant.ts`); nunca tocam contas seed (banco compartilhado com produção).
- Ajustar qualquer fixture/spec que crie caixa sem dono.

## Riscos
- Banco compartilhado com produção: migração precisa ser aditiva e nullable (ok).
- Fluxos existentes que criam caixa sem dono (seed/testes) quebram até receberem o campo — mapeados acima.
