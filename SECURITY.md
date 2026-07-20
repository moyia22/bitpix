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

## Práticas
- Segredos apenas em secret manager / variáveis do host.
- HSTS somente após validar TLS (bloco comentado no nginx).
- Scan de imagem (Trivy) no CI; `npm audit` em produção.
- Rodar `/security-review` antes de releases relevantes.

## Reporte de vulnerabilidades
Definir canal privado (ex.: security@bitpix.example.com) e SLA de resposta.
