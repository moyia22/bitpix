# Gestão completa de usuários (painel admin) + 2FA obrigatório para administradores

Data: 2026-07-20 · Status: aprovado para planejamento

## Objetivo

Permitir que um administrador gerencie usuários inteiramente pelo painel — criar
(com e‑mail e senha), editar (nome, e‑mail, função, filial), redefinir senha,
redefinir 2FA, ativar/desativar, revogar sessões e excluir — e tornar o **2FA
(TOTP) obrigatório** para administradores tanto no **login** quanto nas **ações
sensíveis** (step‑up).

Não é um sistema fiscal; nada aqui envolve emissão fiscal.

## Decisões (confirmadas)

1. **Excluir usuário**: exclusão definitiva **somente** se o usuário não tiver
   nenhum registro vinculado (venda, sessão de caixa, movimento, auditoria,
   configuração). Caso contrário, **desativa** (soft delete) e revoga sessões.
2. **Senha definida pelo admin**: já vale imediatamente; checkbox opcional
   "exigir troca no 1º login" (padrão **desligado**), que usa `mustResetPassword`.
3. **2FA para administradores**: **obrigatório no login** + **step‑up** (reconfirmar
   o código) nas ações sensíveis (definir senha, excluir, redefinir 2FA).
4. **Matrícula de 2FA (Abordagem A)**: login com senha cria a sessão; se o admin
   ainda não tem TOTP, a sessão fica **pendente de matrícula**, restrita às rotas
   de configuração de 2FA até confirmar.

## Não requer migration

Todos os campos necessários já existem no schema Prisma: `User.mfaEnabled`,
`mfaSecretCiphertext/Iv/AuthTag`, `mustResetPassword`, `recoveryCodesVersion`,
`MfaRecoveryCode`, `PasswordResetToken`. Não há alteração de banco.

## Definições

- `userRequiresMfa(user)` → verdadeiro se `user.isPlatformAdmin` **ou** o usuário
  possui qualquer permissão administrativa (`users.*` ou `roles.*`).
- `REQUIRE_MFA_FOR_ADMINS` (novo env, enum `"true"|"false"`): quando `true`,
  aplica a obrigatoriedade acima. Padrão sugerido: `true`. Em `production` a
  validação de ambiente exige `true` (junto com o `REQUIRE_MFA_FOR_PLATFORM` já
  existente). Em desenvolvimento pode ser `false` para não travar durante os testes
  manuais — mas o teste automatizado exercita ambos os caminhos.

## Backend (API Fastify + Prisma)

### CRUD de usuários (`apps/api/src/modules/users/user.routes.ts`)

| Método/rota | Novo? | Permissão | Step‑up 2FA | Comportamento |
|---|---|---|---|---|
| `POST /users` | ajuste | `users.create`/`users.manage` | não | Aceita `requirePasswordChange` (bool, default false) → grava `mustResetPassword`. Demais campos inalterados. |
| `PATCH /users/:id` | existe | `users.update`/`users.manage` | não | Editar nome, e‑mail, função (roleKeys), filial, status. Já implementado; será exposto na UI. |
| `POST /users/:id/set-password` | **novo** | `users.update`/`users.manage` | **sim** | Define nova senha (argon2id), `requirePasswordChange?`, revoga todas as sessões do alvo, auditoria. Não permite no próprio usuário via esta rota (usar troca de senha própria). |
| `DELETE /users/:id` | **novo** | `users.disable`/`users.manage` | **sim** | Se o alvo não tem histórico vinculado → `prisma.user.delete`. Senão → `status=INACTIVE` + revoga sessões. Bloqueia excluir a si mesmo (`SELF_DELETE_FORBIDDEN`). Resposta indica `{ deleted: true | false, deactivated: true }`. |
| `POST /users/:id/reset-mfa` | **novo** | `users.update`/`users.manage` | **sim** | Zera MFA do alvo (`mfaEnabled=false`, limpa segredo, apaga `MfaRecoveryCode`), força re‑matrícula, revoga sessões do alvo, auditoria. |
| `POST /users/:id/revoke-sessions` | existe | `users.sessions.revoke`/`users.manage` | não | Inalterado. |

**Checagem de histórico para exclusão** (dentro de uma transação): considera o
usuário "sem histórico" quando não há `Sale`, `CashSession` (como operador),
`CashMovement`, `AuditLog` (userId), `ProviderConfiguration` (configuredBy/updatedBy),
`ExportJob` nem `UserSession` remanescente vinculados. `MfaRecoveryCode`,
`PasswordResetToken` e `UserRole` são removidos em cascata/limpeza antes do delete.

### Senha e sessão (`apps/api/src/modules/auth`)

- `POST /auth/password/change` (**novo**, autenticado): `{ currentPassword, newPassword }`.
  Verifica a senha atual, grava novo hash, `mustResetPassword=false`, revoga as
  **outras** sessões, auditoria. Rate‑limit dedicado.

### 2FA: obrigatoriedade e step‑up

- **Login** (`auth.service.ts`): se `REQUIRE_MFA_FOR_ADMINS` e `userRequiresMfa(user)`
  e `!user.mfaEnabled` → o login **continua** e cria sessão, mas o principal recebe
  `mfaEnrollmentPending: true`. Se `mfaEnabled`, o fluxo atual (código/recuperação)
  permanece.
- **Guarda de sessão pendente** (`auth.guard.ts`): quando a sessão pertence a um
  usuário com `userRequiresMfa` e `!mfaEnabled`, bloquear todas as rotas exceto
  `POST /auth/mfa/setup`, `POST /auth/mfa/confirm`, `GET /auth/me`, `POST /auth/logout`
  (erro `MFA_ENROLLMENT_REQUIRED`, 403). Também expor `mfaEnrollmentPending` e
  `mustResetPassword` no principal para os portões do frontend.
- **Step‑up** (`assertStepUpMfa(request, code)`): helper que exige `mfaEnabled` do
  ator e um `mfaCode` TOTP válido; caso contrário `MFA_REQUIRED` (428) ou
  `MFA_INVALID` (401). Usado por set‑password, delete e reset‑mfa. O `mfaCode`
  chega no corpo da requisição.

### Contratos (`packages/contracts/src/index.ts`)

- `createUserSchema`: adicionar `requirePasswordChange: z.boolean().optional()`.
- `setPasswordSchema`: `{ password: <mesma política>, requirePasswordChange?: boolean, mfaCode: string(6) }`.
- `deleteUserSchema` / `resetMfaSchema`: `{ mfaCode: string(6) }`.
- `changePasswordSchema`: `{ currentPassword, newPassword }`.
- `SessionPrincipal`: adicionar `mfaEnrollmentPending: boolean` e `mustResetPassword: boolean`.

## Frontend (Next.js)

### Tela /usuarios (`features/admin/user-manager.tsx`)
Expandir para uma tabela com ações por linha e modais:
- **Criar**: nome, e‑mail, senha, função, filial, checkbox "exigir troca no 1º login".
- **Editar**: nome, e‑mail, função, filial (modal → `PATCH`).
- **Redefinir senha**: nova senha + checkbox de troca (modal) → `set-password` (pede código 2FA).
- **Redefinir 2FA**: confirma e chama `reset-mfa` (pede código 2FA).
- **Ativar/Desativar**: `PATCH status`.
- **Excluir**: confirmação clara (informando que vira desativação se houver histórico) → `DELETE` (pede código 2FA).
- **Revogar sessões**: mantém.
- **Modal de step‑up**: componente reutilizável que coleta o código TOTP do admin e o injeta na chamada sensível.

### Tela de Segurança / 2FA (nova, ex.: `/configuracoes/seguranca`)
Fluxo com os endpoints existentes: confirmar senha → exibir QR + `otpauth` →
confirmar código → mostrar códigos de recuperação (uma vez) → 2FA ativo. Botão
desativar (senha + código).

### Portões pós‑login
- Se `mfaEnrollmentPending` → redireciona para a tela de 2FA e bloqueia o resto.
- Se `mustResetPassword` → redireciona para troca de senha e bloqueia o resto.
- **Login** (`features/auth/login-form.tsx`): tratar `428 MFA_REQUIRED` exibindo o
  campo de código (e alternativa por código de recuperação). Verificar se já existe;
  ajustar se necessário.

## Testes (Vitest + integração, padrão atual)
- `set-password`: exige step‑up; revoga sessões do alvo; aplica `requirePasswordChange`.
- `delete`: exclui de vez quando sem histórico; desativa quando há histórico; bloqueia auto‑exclusão; exige step‑up.
- `reset-mfa`: zera MFA do alvo e revoga sessões; exige step‑up.
- `password/change`: troca própria senha, limpa `mustResetPassword`, revoga outras sessões.
- **Login admin sem MFA**: cria sessão pendente; guarda bloqueia rotas fora de `/auth/mfa/*`; após confirmar TOTP, acesso liberado; próximo login exige código.
- **Step‑up ausente/ inválido**: 428/401 nas rotas sensíveis.
- Isolamento multiempresa e permissões mantidos.

## Segurança
- Toda ação sensível: permissão + step‑up 2FA + auditoria sanitizada.
- Não é possível excluir/desativar/redefinir a própria conta pelas rotas de admin.
- Senha nunca registrada em log; códigos de recuperação apenas em hash.
- Step‑up impede que uma sessão sequestrada faça alterações sem o código TOTP.

## Fora de escopo
- 2FA obrigatório para usuários **não** administradores (fica opcional para eles).
- Recuperação de senha por e‑mail já existe (SMTP) e não muda aqui.
- SSO/ąprovações externas.

## Arquivos afetados (previsão)
- API: `modules/users/user.routes.ts`, `modules/auth/{auth.service,auth.guard,auth.routes,mfa.service}.ts`, `config/env.ts`.
- Contracts: `src/index.ts`.
- Web: `features/admin/user-manager.tsx`, nova tela de 2FA, `features/auth/login-form.tsx`, portões no layout protegido.
- Testes: `apps/api/tests/*` (novos casos).
