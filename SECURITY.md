# Segurança — BitPix

## Implementado (confirmado no código)
| Área | Implementação |
|------|---------------|
| Senhas | Argon2id (`argon2`) |
| Sessões | Opacas, revogáveis, cookies HttpOnly; poda automática (worker) |
| Rate limit | `@fastify/rate-limit` (120/min, ban após 3 abusos) |
| Cabeçalhos | `@fastify/helmet` + CSP restrita |
| CORS | Origem única (`APP_URL`), `credentials: true`, verificação de `Origin` em mutações |
| Criptografia | AES-256-GCM (`secret-vault`) para Access Token e segredo MFA |
| Webhook | HMAC-SHA256 + `timingSafeEqual` + janela de timestamp (anti-replay) |
| Idempotência | Restrições únicas por evento/pagamento/movimento; sem regressão de estado |
| Multiempresa | Isolamento por `companyId`/`branchId` em todas as consultas |
| RBAC | Permissões verificadas no backend (não só no menu) |
| Auditoria | `AuditLog` com `correlationId`, payload sanitizado |
| Upload | MIME mágico conferido (PNG/JPEG/WebP), limite 2 MB, nome aleatório; SVG recusado |
| Storage | Path-traversal guard; S3 privado + URLs assinadas em produção |
| MFA | TOTP + códigos de recuperação (hash), segredo cifrado |
| Reset de senha | Token hasheado, expiração, uso único, resposta neutra |
| IDOR | Identificadores públicos são UUID; acesso sempre filtrado por tenant |

## Validação de ambiente (produção — `env.ts`)
Bloqueia o boot se: `PAYMENT_PROVIDER_MODE=mock`; fallback de webhook; APP_URL/webhook/MP em HTTP; storage não-S3; SMTP ausente; MFA off; Redis sem auth; chave de criptografia ≠ 32 bytes; `NODE_ENV != production`.

## Checklist OWASP (revisão)
- [x] XSS: CSP + escaping do framework.
- [x] SQL injection: Prisma (queries parametrizadas).
- [x] CSRF: cookies + verificação de Origin em mutações.
- [x] IDOR: filtragem por tenant + UUID público.
- [x] Brute force: rate limit + ban + (recomendado) bloqueio progressivo por conta.
- [x] Replay: janela de timestamp + fingerprint único.
- [x] Path traversal: validação de chave de storage.
- [ ] SSRF: revisar toda chamada saída (MP é host fixo `https://api.mercadopago.com`). Manter allowlist.
- [ ] Session fixation: sessão é recriada no login (confirmar rotação de id).
- [x] Vazamento de token: segredos nunca logados; verificar em code review de logs.

## Gestão de usuários e 2FA de administradores

Gerenciamento completo de contas pelo painel (`/usuarios`), com 2FA obrigatório para administradores.

**Endpoints (API):**
- `POST /users` — cria usuário (aceita `requirePasswordChange`, padrão `false`).
- `PATCH /users/:id` — edita nome, e‑mail, função e filial; ativa/desativa.
- `POST /users/:id/set-password` — admin redefine a senha (revoga as sessões do alvo). Exige **step‑up 2FA**.
- `DELETE /users/:id` — **exclui de vez se não houver histórico** (venda/caixa/movimento/auditoria/exportação/reembolso/config); caso contrário **desativa** e revoga sessões. Bloqueia auto‑exclusão. Exige **step‑up 2FA**.
- `POST /users/:id/reset-mfa` — zera o 2FA de um usuário (força re‑matrícula). Exige **step‑up 2FA**.
- `POST /users/:id/revoke-sessions` — revoga sessões ativas.
- `POST /auth/password/change` — troca da própria senha (revoga as demais sessões).

**2FA (TOTP) para administradores** (`REQUIRE_MFA_FOR_ADMINS`, obrigatório em produção):
- "Administrador" = superadmin **ou** quem possui permissão `users.*`/`roles.*`.
- No login sem 2FA, a sessão fica **pendente de matrícula** e só acessa a tela de configuração de 2FA (`/configuracoes/seguranca`) até confirmar o TOTP.
- **Step‑up**: `set-password`, `delete` e `reset-mfa` exigem o código TOTP do próprio administrador na requisição — uma sessão sequestrada não consegue executá‑las sem o autenticador.
- Portões pós‑login no frontend forçam configurar 2FA (`mfaEnrollmentPending`) ou trocar a senha (`mustResetPassword`) antes de usar o resto.
- Segredo TOTP cifrado (AES‑256‑GCM); 10 códigos de recuperação em hash SHA‑256.

Toda ação sensível: verificação de permissão + step‑up 2FA + auditoria; senha nunca registrada em log.

## Práticas
- Segredos apenas em secret manager / variáveis do host.
- HSTS somente após validar TLS (bloco comentado no nginx).
- Scan de imagem (Trivy) no CI; `npm audit` em produção.
- Rodar `/security-review` antes de releases relevantes.

## Reporte de vulnerabilidades
Definir canal privado (ex.: security@bitpix.example.com) e SLA de resposta.
