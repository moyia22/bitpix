"use client";

import type { ApiErrorBody, ProviderIntegrationDto } from "@bitpix/contracts";
import { CheckCircle2, Clipboard, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
const statusLabels: Record<string, string> = {
  NOT_CONFIGURED: "Não configurado", CONFIGURING: "Aguardando teste", CONNECTED: "Conectado", OPERATIONAL: "Operacional",
  INVALID_TOKEN: "Token inválido", REVOKED: "Token revogado", TEMPORARY_FAILURE: "Falha temporária", PERMISSION_ERROR: "Permissão insuficiente", WEBHOOK_MISSING: "Conectado — webhook sem assinatura",
};

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json() as ApiErrorBody;
  return body.error?.message ?? "Não foi possível concluir a operação.";
}

export function MercadoPagoSettings({ initial }: { initial: ProviderIntegrationDto }) {
  const [integration, setIntegration] = useState(initial);
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [environment, setEnvironment] = useState<"TEST" | "PRODUCTION">(initial.environment);
  const [expiration, setExpiration] = useState(initial.pixExpirationMinutes);
  const [showToken, setShowToken] = useState(false);
  const [working, setWorking] = useState<"save" | "test" | "remove" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setNotice(""); setWorking("save");
    try {
      const response = await fetch(`${apiUrl}/api/v1/integrations/mercado-pago`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken, ...(webhookSecret.trim() ? { webhookSecret } : {}), environment, pixExpirationMinutes: expiration }) });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json() as { data: ProviderIntegrationDto }; setIntegration(body.data); setAccessToken(""); setNotice("Credencial salva com segurança. Faça o teste de conexão.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao salvar."); } finally { setWorking(null); }
  };

  const test = async () => {
    setError(""); setNotice(""); setWorking("test");
    try {
      const response = await fetch(`${apiUrl}/api/v1/integrations/mercado-pago/test`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json() as { data: ProviderIntegrationDto }; setIntegration(body.data); setNotice("Conexão validada com sucesso.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao testar."); } finally { setWorking(null); }
  };

  const remove = async () => {
    if (!window.confirm("Remover a credencial do Mercado Pago desta empresa? O histórico será preservado.")) return;
    setError(""); setNotice(""); setWorking("remove");
    try {
      const response = await fetch(`${apiUrl}/api/v1/integrations/mercado-pago`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json() as { data: ProviderIntegrationDto }; setIntegration(body.data); setNotice("Credencial removida. O histórico de auditoria foi preservado.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao remover."); } finally { setWorking(null); }
  };

  const copyWebhook = async () => { await navigator.clipboard.writeText(integration.webhookUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const busy = working !== null;

  return (
    <div className="integration-layout">
      <section className="card integration-form-card">
        <div className="integration-card-heading"><span><KeyRound size={21} /></span><div><h2>Credencial de acesso</h2><p>O token é cifrado antes de chegar ao banco e nunca volta para o navegador.</p></div></div>
        <form onSubmit={(event) => void save(event)}>
          <label className="field-label" htmlFor="mp-environment">Ambiente</label>
          <select id="mp-environment" className="field-input" value={environment} onChange={(event) => setEnvironment(event.target.value as "TEST" | "PRODUCTION")} disabled={integration.providerMode === "mock"}><option value="TEST">Teste</option><option value="PRODUCTION">Produção</option></select>
          <label className="field-label mt-5" htmlFor="mp-token">Access Token</label>
          <div className="integration-secret"><input id="mp-token" className="field-input" type={showToken ? "text" : "password"} value={accessToken} onChange={(event) => setAccessToken(event.target.value)} autoComplete="new-password" placeholder={integration.credentialMasked ?? (integration.providerMode === "mock" ? "TEST-MOCK-..." : "APP_USR-...")} required /><button type="button" onClick={() => setShowToken((value) => !value)} aria-label={showToken ? "Ocultar token" : "Mostrar token"}>{showToken ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          <p className="integration-help">{integration.credentialMasked ? `Credencial atual: ${integration.credentialMasked}. Informe uma nova somente para substituí-la.` : "Obtenha o Access Token nas credenciais da sua aplicação no Mercado Pago."}</p>
          <label className="field-label mt-5" htmlFor="mp-webhook-secret">Assinatura secreta do webhook</label>
          <input id="mp-webhook-secret" className="field-input" type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} autoComplete="new-password" placeholder={integration.webhookSecretConfigured ? "Segredo já configurado" : "Informe o segredo exibido em Webhooks"} />
          <p className="integration-help">Usada somente no backend para validar <code>x-signature</code>. Nunca será exibida novamente.</p>
          <label className="field-label mt-5" htmlFor="mp-expiration">Validade do Pix</label>
          <select id="mp-expiration" className="field-input" value={expiration} onChange={(event) => setExpiration(Number(event.target.value))}><option value={30}>30 minutos</option><option value={60}>1 hora</option><option value={1440}>24 horas</option></select>
          <button className="primary-button mt-6 w-full" disabled={busy || !accessToken.trim()}>{working === "save" && <LoaderCircle className="animate-spin" size={18} />} Salvar credencial</button>
        </form>
      </section>

      <aside className="space-y-5">
        <section className="card integration-status-card">
          <div className="flex items-start justify-between gap-4"><div><p className="cash-kicker">Estado da conexão</p><h2>{statusLabels[integration.status] ?? integration.status}</h2></div><span className={`integration-status-dot status-${integration.status.toLowerCase()}`} /></div>
          {integration.providerMode === "mock" && <div className="mock-provider-banner mt-5">Modo simulado ativo — uso proibido em produção</div>}
          <dl className="integration-facts"><div><dt>Provedor</dt><dd>Mercado Pago</dd></div><div><dt>Ambiente</dt><dd>{integration.environment === "TEST" ? "Teste" : "Produção"}</dd></div><div><dt>Último teste</dt><dd>{integration.lastVerifiedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(integration.lastVerifiedAt)) : "Ainda não testado"}</dd></div></dl>
          {integration.lastVerificationError && <p className="cash-notice cash-notice-error">{integration.lastVerificationError}</p>}
          <button type="button" className="primary-button w-full" onClick={() => void test()} disabled={busy || !integration.configured}>{working === "test" ? <LoaderCircle className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} Testar conexão</button>
          {integration.configured && <button type="button" className="integration-remove" onClick={() => void remove()} disabled={busy}><Trash2 size={17} /> Remover credencial</button>}
        </section>
        <section className="card integration-webhook-card"><div className="integration-card-heading"><span><ShieldCheck size={21} /></span><div><h2>Webhook</h2><p>Cadastre esta URL nas notificações da sua aplicação no Mercado Pago.</p></div></div><div className="integration-webhook-url"><code>{integration.webhookUrl}</code><button type="button" onClick={() => void copyWebhook()} aria-label="Copiar URL do webhook">{copied ? <CheckCircle2 size={18} /> : <Clipboard size={18} />}</button></div></section>
        {(notice || error) && <div className={`cash-notice ${error ? "cash-notice-error" : "cash-notice-success"}`} role="status">{error || notice}</div>}
      </aside>
    </div>
  );
}
