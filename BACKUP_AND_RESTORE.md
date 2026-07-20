# Backup e Restauração — BitPix

## Princípios
- Backup diário do PostgreSQL, criptografado (AES-256) e enviado para storage **fora do servidor de aplicação**.
- Retenção configurável (`BACKUP_RETENTION_DAYS`, padrão 30).
- Registro de sucesso/falha em JSON (para alertas).
- **Um backup só é válido depois de restaurado e verificado.**

## Scripts
| Script | Função |
|--------|--------|
| `scripts/backup.sh` | `pg_dump` → gzip → gpg (AES256) → upload S3 → retenção |
| `scripts/restore.sh` | Baixa, descriptografa e restaura (exige `RESTORE_CONFIRM=yes`) |
| `scripts/verify-backup.sh` | Restaura em banco temporário descartável e valida |

## Variáveis
```
PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
BACKUP_ENCRYPTION_PASSPHRASE
BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY
BACKUP_RETENTION_DAYS
```

## Backup manual
```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  exec backup /scripts/backup.sh
```

## Agendamento (cron do host)
```cron
# 03:15 todos os dias
15 3 * * * cd /opt/bitpix && docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T backup /scripts/backup.sh >> /var/log/bitpix-backup.log 2>&1
# Verificação semanal (domingo 04:00) do backup mais recente
0 4 * * 0 cd /opt/bitpix && docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T backup /scripts/verify-backup.sh s3://$BACKUP_S3_BUCKET/$(latest) >> /var/log/bitpix-verify.log 2>&1
```

## Restauração
```bash
RESTORE_CONFIRM=yes ./scripts/restore.sh s3://bitpix-backups/bitpix_bitpix_20260720T031500Z.sql.gz.gpg
# ou arquivo local
RESTORE_CONFIRM=yes ./scripts/restore.sh /backups/arquivo.sql.gz.gpg
```
> Operação destrutiva. Faça em janela planejada e com backup atual do estado corrente.

## Verificação (obrigatória)
```bash
./scripts/verify-backup.sh s3://bitpix-backups/<arquivo>
```
Cria banco `bitpix_verify_*`, restaura, confere contagem de tabelas e o remove. Alertar em falha.

## Checklist
- [ ] Backup diário rodando e enviado para fora do servidor.
- [ ] Retenção aplicada.
- [ ] Verificação por restauração passou nesta semana.
- [ ] Passphrase de criptografia guardada em secret manager (sem ela, o backup é inútil).
