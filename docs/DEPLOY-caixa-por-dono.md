# Deploy — Caixa por dono + senha mínima de 6

Branch: `feat/caixa-por-dono-senha`. Duas mudanças: senha mínima cai para 6, e cada caixa passa a ter um **dono** (só o dono abre sessão; admin com `cash.session.open.any` faz override).

## O que já foi feito

- **Migração de banco aplicada no Supabase** (`prisma migrate deploy` → `20260724000000_cash_register_owner`). A coluna `CashRegister.ownerUserId` (nullable, índice único, FK RESTRICT) já existe no banco compartilhado. Não precisa rodar de novo.

## Passos de deploy na VPS

1. **Deploy do app** (API + Web) com o código desta branch.
2. **(Se sua VPS aplica migrações no boot)** `npm run deploy -w @bitpix/database` (= `prisma migrate deploy`) é idempotente — a migração já aplicada será apenas reconhecida.

## Cutover obrigatório (pós-deploy) — atenção

A migração é aditiva/nullable: **todos os caixas que já existiam ficam sem dono**. Com o novo enforcement, um operador comum (que tem `cash.session.open` mas não `cash.session.open.any`) recebe **403 `CASH_REGISTER_NOT_OWNER`** ao tentar abrir um caixa sem dono.

Portanto, antes de os operadores voltarem a operar:

- **Atribua um dono a cada caixa existente.** Pela tela de Caixa (admin), editar cada caixa e escolher o dono. Isso usa `cash.register.update` (admins já têm). Depois disso, o dono abre o próprio caixa normalmente — sem precisar de override.

## Habilitar o override (`cash.session.open.any`) para tenants existentes — opcional

O override é para exceções (admin abrir o caixa de outro). A permissão é nova: empresas **criadas antes desta mudança** não têm a linha de permissão nem o vínculo no papel ADMIN, porque o vínculo é feito no momento da criação da empresa. O fluxo normal (dono abre o próprio caixa) **não depende disso**.

Se quiser o override disponível para admins de empresas já existentes, faça um backfill (o mecanismo exato depende de como você mantém dados de produção):

1. Garantir a linha em `Permission` com `key = "cash.session.open.any"` (nome/descrição no catálogo do seed).
2. Para cada papel `ADMIN` existente, criar o `RolePermission` ligando esse papel à permissão.

Empresas **novas** (criadas após o deploy) já recebem a permissão automaticamente (a criação de empresa concede ao ADMIN todas as permissões não-`platform.*`).

> Observação: rodar o `seed` completo em produção também registra a permissão, mas ele faz upserts das contas de demonstração do seed — prefira um script de backfill direcionado se não quiser tocar essas contas.

## Senha mínima de 6

Sem passo de deploy. Passa a valer para novos cadastros/trocas de senha assim que o app novo subir. Senhas existentes continuam válidas.
