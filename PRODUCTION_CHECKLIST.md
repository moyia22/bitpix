# Checklist de Produção — BitPix

## Infraestrutura
- [ ] WSL2 + distro Linux instalada e Docker Desktop funcional (`docker run --rm hello-world`).
- [ ] `docker compose -f docker-compose.yml -f docker-compose.production.yml config` válido.
- [ ] Postgres e Redis **não** publicados em rede pública (só rede interna).
- [ ] Volumes persistentes configurados; nunca usar `down -v`.
- [ ] Limites de CPU/memória e `no-new-privileges` ativos.
- [ ] Containers rodando como usuário não-root (Dockerfile `USER node`).

## Configuração / segredos
- [ ] `.env` de produção via secret manager (nada versionado).
- [ ] `PROVIDER_CREDENTIALS_ENCRYPTION_KEY` = 32 bytes Base64.
- [ ] `REDIS_URL` com autenticação.
- [ ] `STORAGE_DRIVER=s3` com bucket privado.
- [ ] SMTP autenticado configurado.
- [ ] `PAYMENT_PROVIDER_MODE=real`, `WEBHOOK_LOCAL_FALLBACK=false`.
- [ ] `REQUIRE_MFA_FOR_PLATFORM=true`.
- [ ] Boot da API passa na validação de ambiente (falha se inseguro).

## Rede / TLS
- [ ] Domínios de web e API com DNS.
- [ ] Certificado TLS válido; nginx HTTPS habilitado.
- [ ] Redirecionamento HTTP→HTTPS ativo.
- [ ] HSTS habilitado **após** validar TLS.
- [ ] Webhook público HTTPS terminando em `/api/v1/webhooks/mercado-pago`.
- [ ] SSE validado através do proxy (buffering off).

## Dados
- [ ] Migrations aplicadas (`db:deploy`); seed de dev **não** executado.
- [ ] Backup diário rodando e enviado para fora do servidor.
- [ ] Restauração testada com sucesso (`verify-backup.sh`).
- [ ] Passphrase de backup no secret manager.

## Observabilidade / alertas
- [ ] Prometheus coletando `/health/metrics`.
- [ ] Alertas configurados (API/DB/Redis/worker/erros/backup).
- [ ] Logs sem segredos (token, cookies, copia-e-cola, senhas).

## Aplicação
- [ ] `/health/ready` = ready (Redis + worker obrigatórios).
- [ ] Login funciona; MFA do superadmin ativo.
- [ ] Recuperação de senha funciona (com SMTP).
- [ ] Fluxo Pix ponta a ponta validado com credencial de teste (ver `MERCADO_PAGO_HOMOLOGATION.md`).

## Qualidade
- [ ] `lint`, `typecheck`, `test`, `test:e2e`, `build` verdes.
- [ ] `npm audit --omit=dev` sem HIGH/CRITICAL não tratados.
- [ ] Scan de imagem (Trivy) revisado.
- [ ] Repositório sob controle de versão (Git) com tag de release.

## Não fazer
- [ ] Sem `docker compose down -v`.
- [ ] Sem seed de desenvolvimento em produção.
- [ ] Sem Redis/worker opcionais em produção.
- [ ] Sem esconder readiness degradado.
- [ ] Sem emissão fiscal (NFC-e/NF-e/DANFE/etc.).
