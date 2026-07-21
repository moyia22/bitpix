"use client";

import type { ApiErrorBody } from "@bitpix/contracts";
import { KeyRound, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export function PasswordChange({ forced }: { forced?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/password/change`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: String(form.get("currentPassword")), newPassword: String(form.get("newPassword")) }),
      });
      if (!response.ok) {
        const body = await response.json() as ApiErrorBody;
        throw new Error(body.error?.message ?? "Não foi possível alterar a senha.");
      }
      setDone(true);
      window.setTimeout(() => window.location.assign("/nova-venda"), 900);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao alterar a senha.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card integration-form-card" style={{ maxWidth: 460 }}>
      <div className="integration-card-heading">
        <span><KeyRound size={21} /></span>
        <div>
          <h2>Alterar senha</h2>
          <p>{forced ? "Defina uma nova senha para continuar." : "Escolha uma nova senha para sua conta."}</p>
        </div>
      </div>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="current-password">Senha atual</label>
        <input id="current-password" className="field-input" type="password" name="currentPassword" autoComplete="current-password" required />
        <label className="field-label mt-5" htmlFor="new-password">Nova senha</label>
        <input id="new-password" className="field-input" type="password" name="newPassword" minLength={12} autoComplete="new-password" required />
        <p className="integration-help">Mínimo de 12 caracteres. As demais sessões serão encerradas.</p>
        {error && <div className="cash-notice cash-notice-error mt-3" role="alert">{error}</div>}
        {done && <div className="cash-notice cash-notice-success mt-3" role="status">Senha alterada. Redirecionando…</div>}
        <button className="primary-button mt-6 w-full" disabled={busy || done}>
          {busy ? <LoaderCircle className="animate-spin" size={18} /> : <KeyRound size={18} />} Alterar senha
        </button>
      </form>
    </section>
  );
}
