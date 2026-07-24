# Deploy — Caixa por dono + senha mínima de 6

Branch: `feat/caixa-por-dono-senha`. Duas mudanças: senha mínima cai para 6, e cada caixa passa a ter um **dono** (só o dono abre sessão; admin com `cash.session.open.any` faz override).

## O que já foi feito

- **Migração de banco aplicada no Supabase** (`prisma migrate deploy` → `20260724000000_cash_register_owner`). A coluna `CashRegister.ownerUserId` (nullable, índice único, FK RESTRICT) já existe no banco compartilhado. Não precisa rodar de novo.

## Passos de deploy na VPS

1. **Deploy do app** (API + Web) com o código desta branch.
2. **(Se sua VPS aplica migrações no boot)** `npm run deploy -w @bitpix/database` (= `prisma migrate deploy`) é idempotente — a migração já aplicada será apenas reconhecida.

## Modelo atual: um caixa por usuário (automático)

- **Usuários novos**: ao criar um usuário, o sistema já cria o **caixa dedicado** dele (dono 1:1), na filial do usuário ou na primeira filial ativa da empresa.
- **Cada usuário abre/vê só o próprio caixa**; quem tem a permissão `cash.session.open.any` (admin) enxerga e opera todos, pelo painel admin.
- **Excluir usuário**: anonimiza a conta (nome "Usuário removido", e-mail/senha/2FA/funções limpos, sessões revogadas) e remove o caixa dele (ou libera+inativa se houver histórico). Vendas/pagamentos/auditoria são **preservados**.

## Cutover obrigatório (pós-deploy): backfill dos usuários existentes

Os usuários que já existiam **antes** desta mudança ainda não têm caixa. Rode uma vez o backfill (idempotente, aditivo — cria o caixa de quem não tem, ignora quem já tem):

```bash
npm run backfill-caixas -w @bitpix/database
```

Depois disso, cada usuário abre o próprio caixa normalmente. Enquanto o backfill não roda, um usuário sem caixa não terá um caixa para abrir (e um operador comum não abre o de outro por causa do enforcement).

> Observação: o `DATABASE_URL` aponta para o banco compartilhado; o backfill cria caixas para os usuários ativos de **todas as empresas** desse banco.

## Habilitar o override (`cash.session.open.any`) para tenants existentes — opcional

O override é para exceções (admin abrir o caixa de outro). A permissão é nova: empresas **criadas antes desta mudança** não têm a linha de permissão nem o vínculo no papel ADMIN, porque o vínculo é feito no momento da criação da empresa. O fluxo normal (dono abre o próprio caixa) **não depende disso**.

Se quiser o override disponível para admins de empresas já existentes, faça um backfill (o mecanismo exato depende de como você mantém dados de produção):

1. Garantir a linha em `Permission` com `key = "cash.session.open.any"` (nome/descrição no catálogo do seed).
2. Para cada papel `ADMIN` existente, criar o `RolePermission` ligando esse papel à permissão.

Empresas **novas** (criadas após o deploy) já recebem a permissão automaticamente (a criação de empresa concede ao ADMIN todas as permissões não-`platform.*`).

> Observação: rodar o `seed` completo em produção também registra a permissão, mas ele faz upserts das contas de demonstração do seed — prefira um script de backfill direcionado se não quiser tocar essas contas.

## Senha mínima de 6

Sem passo de deploy. Passa a valer para novos cadastros/trocas de senha assim que o app novo subir. Senhas existentes continuam válidas.
