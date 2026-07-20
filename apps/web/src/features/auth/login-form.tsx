"use client";

import { Eye, EyeOff, LoaderCircle, LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string } };
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
      {error && <div role="alert" className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_25%,var(--border))] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger)]">{error}</div>}
      <button className="primary-button w-full" type="submit" disabled={busy}>
        {busy ? <LoaderCircle className="animate-spin" size={19} /> : <LogIn size={19} />}
        {busy ? "Entrando..." : "Entrar no BitPix"}
      </button>
    </form>
  );
}
