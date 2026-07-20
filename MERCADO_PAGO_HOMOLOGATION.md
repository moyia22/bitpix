# Homologação Mercado Pago — BitPix

> **Estado atual: NÃO homologado.** Nenhum Access Token real está no projeto.
> A estrutura (Orders API, webhook, assinatura, worker, confirmação, caixa, SSE,
> comprovante, reconciliação, reembolso) está **pronta**, mas depende de uma
> credencial real para ser validada. Nada aqui deve ser marcado como "operacional"
> até os passos abaixo passarem com credencial de teste válida.

## O que depende da credencial
- Modo `PAYMENT_PROVIDER_MODE=real`.
- Access Token configurado **pela interface** por empresa (cifrado com AES-256-GCM; nunca no código).
- Segredo de webhook por empresa (assinatura `x-signature`).
- URL HTTPS pública terminada em `/api/v1/webhooks/mercado-pago`.

## Configuração
1. Na conta Mercado Pago, criar aplicação e obter **Access Token de teste**.
2. Cadastrar notificação de **Orders** apontando para a URL pública do webhook.
3. Copiar a **assinatura secreta** para a configuração da integração da empresa (na interface BitPix).
4. Expor a API por HTTPS público:
   - Produção: domínio + proxy nginx (ver `DEPLOYMENT.md`).
   - Teste local: túnel HTTPS confiável **apenas para a API** (nunca exponha Postgres/Redis).
5. Definir `PUBLIC_WEBHOOK_BASE_URL` com a URL pública.

## Roteiro de validação (executar com credencial de teste)
Marque cada item só após confirmar de verdade:
1. [ ] Conexão com o provedor (token válido).
2. [ ] Criação de cobrança Pix (Orders API).
3. [ ] QR Code gerado.
4. [ ] Pix Copia e Cola gerado.
5. [ ] Consulta da Order (`GET /v1/orders/{id}`).
6. [ ] Webhook público recebido.
7. [ ] Assinatura HMAC-SHA256 validada (+ anti-replay).
8. [ ] Job processado pelo worker.
9. [ ] Confirmação (`PixPayment` criado).
10. [ ] Caixa atualizado (`CashMovement PIX_PAYMENT`).
11. [ ] SSE emite evento em tempo real.
12. [ ] Comprovante (não fiscal) impresso.
13. [ ] Reconciliação confere.
14. [ ] Expiração de cobrança tratada.
15. [ ] Reembolso (quando seguro; `PIX_REFUND` só após confirmação do provedor).

## Regras invioláveis
- O status do webhook **nunca** confirma pagamento sozinho — sempre consultar a Order.
- Access Token e segredos **nunca** aparecem em logs.
- Reembolso cria `PIX_REFUND` **somente** após o provedor confirmar o estorno.
- Não emitir documento fiscal (o cupom é não fiscal).

## Documentação oficial
- Webhooks e validação de assinatura, Orders API, Consultar Order, Reembolsos/cancelamentos (links no `README.md`).
