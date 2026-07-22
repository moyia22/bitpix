"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Renderiza o cupom como filho direto de <body> (portal), fora da árvore do app.
// Assim a impressão pode ocultar TODO o resto com `display:none`, eliminando as
// páginas em branco e cortes errados que o antigo truque de `visibility` deixava
// passar (o conteúdo escondido continuava ocupando altura e gerava páginas).

const emptySubscribe = () => () => {};

// true no cliente, false no servidor — evita mismatch de hidratação sem
// setState dentro de efeito.
function useIsClient(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function PrintReceipt({ children }: { children: ReactNode }) {
  const isClient = useIsClient();
  if (!isClient) return null;
  return createPortal(
    <article className="pix-print-receipt" aria-hidden="true">{children}</article>,
    document.body,
  );
}
