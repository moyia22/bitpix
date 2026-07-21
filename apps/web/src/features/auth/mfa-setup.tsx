"use client";

import type { ApiErrorBody } from "@bitpix/contracts";
import { Check, Clipboard, KeyRound, LoaderCircle, ShieldAlert, ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useState, type FormEvent } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

type Stage = "enabled" | "password" | "verify" | "recovery";

interface MfaSetupData {
  secret: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json() as ApiErrorBody;
  return body.error?.message ?? "Não foi possível concluir a operação.";
}

export function MfaSetup({ initialEnabled }: { initialEnabled: boolean }) {
  const [stage, setStage] = useState<Stage>(initialEnabled ? "enabled" : "password");
  const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const startSetup = async (event: FormEvent) => {
    event.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json() as { data: MfaSetupData };
      setSetupData(body.data);
      setPassword("");
      setStage("verify");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao iniciar a configuração do 2FA.");
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (event: FormEvent) => {
    event.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/mfa/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json() as { data: { recoveryCodes: string[] } };
      setRecoveryCodes(body.data.recoveryCodes);
      setCode("");
      setStage("recovery");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Código de autenticação inválido.");
    } finally {
      setBusy(false);
    }
  };

  const finishRecovery = () => {
    setRecoveryCodes([]);
    setSetupData(null);
    setNotice("2FA ativado com sucesso.");
    setStage("enabled");
  };

  const disable = async (event: FormEvent) => {
    event.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/mfa/disable`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setDisablePassword("");
      setDisableCode("");
      setNotice("2FA desativado.");
      setStage("password");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível desativar o 2FA.");
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!setupData) return;
    await navigator.clipboard.writeText(setupData.secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (stage === "enabled") {
    return (
      <div className="space-y-5">
        <section className="card integration-status-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="cash-kicker">Autenticação de dois fatores</p>
              <h2>2FA ativado</h2>
            </div>
            <span className="integration-status-dot status-operational" />
          </div>
          <p className="integration-help mt-3">Um código do seu aplicativo autenticador é exigido a cada novo login.</p>
        </section>
        <section className="card integration-form-card">
          <div className="integration-card-heading">
            <span><ShieldOff size={21} /></span>
            <div><h2>Desativar 2FA</h2><p>Confirme sua senha e um código válido do autenticador para desativar.</p></div>
          </div>
          <form onSubmit={(event) => void disable(event)}>
            <label className="field-label" htmlFor="mfa-disable-password">Senha atual</label>
            <input id="mfa-disable-password" className="field-input" type="password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} autoComplete="current-password" required />
            <label className="field-label mt-5" htmlFor="mfa-disable-code">Código do autenticador</label>
            <input id="mfa-disable-code" className="field-input" inputMode="numeric" pattern="\d{6}" maxLength={6} value={disableCode} onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" required />
            <button className="primary-button mt-6 w-full" disabled={busy || !disablePassword.trim() || disableCode.length !== 6}>
              {busy ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldOff size={18} />} Desativar 2FA
            </button>
          </form>
        </section>
        {(notice || error) && <div className={`cash-notice ${error ? "cash-notice-error" : "cash-notice-success"}`} role="status">{error || notice}</div>}
      </div>
    );
  }

  if (stage === "recovery") {
    return (
      <div className="space-y-5">
        <section className="card integration-form-card">
          <div className="integration-card-heading">
            <span><ShieldCheck size={21} /></span>
            <div><h2>Códigos de recuperação</h2><p>Guarde estes códigos em um local seguro. Cada um pode ser usado uma única vez para entrar caso você perca o acesso ao autenticador.</p></div>
          </div>
          <div className="mock-provider-banner"><TriangleAlert size={15} style={{ display: "inline", verticalAlign: "text-bottom", marginRight: 6 }} />Estes códigos só serão exibidos agora</div>
          <div className="grid grid-cols-2 gap-2 mt-5 font-mono text-sm">
            {recoveryCodes.map((value) => (
              <div key={value} className="field-input flex items-center justify-center">{value}</div>
            ))}
          </div>
          <button type="button" className="primary-button mt-6 w-full" onClick={finishRecovery}>
            <Check size={18} /> Já salvei meus códigos
          </button>
        </section>
      </div>
    );
  }

  if (stage === "verify" && setupData) {
    return (
      <div className="space-y-5">
        <section className="card integration-form-card">
          <div className="integration-card-heading">
            <span><KeyRound size={21} /></span>
            <div><h2>Escaneie o QR Code</h2><p>Use um aplicativo autenticador (Google Authenticator, Authy, etc.) para escanear o código abaixo.</p></div>
          </div>
          <div className="pix-qr-shell">
            <Image src={setupData.qrCodeDataUrl} width={320} height={320} unoptimized alt="QR Code para configurar o autenticador" priority />
          </div>
          <p className="integration-help">Não consegue escanear? Informe esta chave manualmente no aplicativo:</p>
          <div className="integration-webhook-url">
            <code>{setupData.secret}</code>
            <button type="button" onClick={() => void copySecret()} aria-label="Copiar chave secreta">{copied ? <Check size={18} /> : <Clipboard size={18} />}</button>
          </div>
          <form onSubmit={(event) => void confirmSetup(event)}>
            <label className="field-label mt-5" htmlFor="mfa-confirm-code">Código de 6 dígitos</label>
            <input id="mfa-confirm-code" className="field-input" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" required autoFocus />
            <button className="primary-button mt-6 w-full" disabled={busy || code.length !== 6}>
              {busy ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldCheck size={18} />} Confirmar e ativar
            </button>
          </form>
        </section>
        {(notice || error) && <div className={`cash-notice ${error ? "cash-notice-error" : "cash-notice-success"}`} role="status">{error || notice}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="card integration-form-card">
        <div className="integration-card-heading">
          <span><ShieldAlert size={21} /></span>
          <div><h2>Ativar 2FA</h2><p>Confirme sua senha atual para iniciar a configuração da autenticação de dois fatores.</p></div>
        </div>
        <form onSubmit={(event) => void startSetup(event)}>
          <label className="field-label" htmlFor="mfa-setup-password">Senha atual</label>
          <input id="mfa-setup-password" className="field-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          <button className="primary-button mt-6 w-full" disabled={busy || !password.trim()}>
            {busy ? <LoaderCircle className="animate-spin" size={18} /> : <KeyRound size={18} />} Continuar
          </button>
        </form>
      </section>
      {(notice || error) && <div className={`cash-notice ${error ? "cash-notice-error" : "cash-notice-success"}`} role="status">{error || notice}</div>}
    </div>
  );
}
