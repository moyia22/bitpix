"use client";

import { LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useState, type FormEvent } from "react";

export function StepUpModal({
  title,
  description,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  busy: boolean;
  error: string;
  onConfirm: (code: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.length === 6) onConfirm(code);
  };
  return (
    <div className="history-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <form className="card history-detail" style={{ maxWidth: 440 }} onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="flex items-start justify-between gap-4">
          <div className="integration-card-heading" style={{ marginBottom: 0 }}>
            <span><ShieldCheck size={21} /></span>
            <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ border: 0, background: "transparent", color: "var(--ink-muted)" }}>
            <X size={18} />
          </button>
        </div>
        <label className="field-label mt-5" htmlFor="stepup-code">Código do autenticador (2FA)</label>
        <input
          id="stepup-code"
          className="field-input"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoFocus
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        />
        {error && <div className="cash-notice cash-notice-error mt-3" role="alert">{error}</div>}
        <button className="primary-button mt-6 w-full" disabled={busy || code.length !== 6}>
          {busy ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldCheck size={18} />} Confirmar
        </button>
      </form>
    </div>
  );
}
