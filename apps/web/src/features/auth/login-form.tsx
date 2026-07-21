"use client";

import { Eye, EyeOff, LoaderCircle, LogIn, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string> = { email: String(form.get("email")), password: String(form.get("password")) };
    if (mfaRequired) {
      if (useRecovery) payload.recoveryCode = recoveryCode.trim();
      else payload.mfaCode = mfaCode.trim();
    }

    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string; code?: string } };
        if (response.status === 428 || body.error?.code === "MFA_REQUIRED") {
          setMfaRequired(true);
          setError(mfaRequired ? (body.error?.message ?? "Código inválido.") : "");
          return;
        }
        setError(body.error?.message ?? "Não foi possível entrar.");
        return;
      }
      window.location.assign("/nova-venda");
    } catch {
      setError("A API não está disponível. Verifique se os serviços estão ativos.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
      <div>
        <label className="field-label" htmlFor="email">E-mail</label>
        <input className="field-input" id="email" name="email" type="email" autoComplete="username" autoFocus required placeholder="voce@empresa.com.br" />
      </div>
      <div>
        <label className="field-label" htmlFor="password">Senha</label>
        <div className="relative">
          <input className="field-input pr-14" id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={8} />
          <button type="button" className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
            {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        </div>
      </div>

      {mfaRequired && (
        <div>
          <label className="field-label" htmlFor="mfa">{useRecovery ? "Código de recuperação" : "Código do autenticador (2FA)"}</label>
          {useRecovery ? (
            <input className="field-input" id="mfa" inputMode="text" autoComplete="one-time-code" autoFocus value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} placeholder="XXXX-XXXX" />
          ) : (
            <input className="field-input" id="mfa" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" autoFocus value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
          )}
          <button type="button" className="mt-2 text-sm font-semibold text-[var(--primary)]" onClick={() => setUseRecovery((value) => !value)}>
            {useRecovery ? "Usar código do autenticador" : "Usar código de recuperação"}
          </button>
        </div>
      )}

      {error && <div role="alert" className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_25%,var(--border))] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger)]">{error}</div>}
      <button className="primary-button w-full" type="submit" disabled={busy}>
        {busy ? <LoaderCircle className="animate-spin" size={19} /> : mfaRequired ? <ShieldCheck size={19} /> : <LogIn size={19} />}
        {busy ? "Entrando..." : mfaRequired ? "Confirmar e entrar" : "Entrar no BitPix"}
      </button>
    </form>
  );
}
