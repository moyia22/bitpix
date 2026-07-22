"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

// Fronteira de erro do app. Trata principalmente a indisponibilidade temporária da
// API (deploy/restart): mostra uma tela limpa com "tentar novamente" e MANTÉM a
// sessão — nunca desloga nem exibe stack. Gates de 2FA/senha usam redirect (não caem aqui).
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log de diagnóstico no console do navegador; não expõe token/cookie/segredo.
    console.error("Falha ao renderizar:", error.message);
  }, [error]);

  return (
    <main id="conteudo-principal" className="grid min-h-screen place-items-center px-5">
      <div className="card w-full max-w-[480px] p-8 text-center">
        <h1 className="display-title">Serviço temporariamente indisponível</h1>
        <p className="mt-3 text-[var(--ink-muted)]">
          Não foi possível carregar agora — isso costuma acontecer durante uma atualização do
          sistema. Sua sessão continua ativa; tente novamente em instantes.
        </p>
        <button type="button" className="primary-button mt-7 w-full justify-center" onClick={reset}>
          <RotateCcw size={18} /> Tentar novamente
        </button>
      </div>
    </main>
  );
}
