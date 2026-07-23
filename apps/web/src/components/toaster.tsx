"use client";

import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

type ToastKind = "success" | "error" | "info";
interface Toast { id: number; kind: ToastKind; message: string }

// Dispara um toast de qualquer componente client, sem provider/prop drilling.
export function toast(message: string, kind: ToastKind = "info") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("bitpix:toast", { detail: { message, kind } }));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    let counter = 0;
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent).detail as { kind?: ToastKind; message?: string };
      if (!detail?.message) return;
      const id = ++counter;
      setToasts((current) => [...current, { id, kind: detail.kind ?? "info", message: detail.message! }]);
      window.setTimeout(() => setToasts((current) => current.filter((toastItem) => toastItem.id !== id)), 3500);
    };
    window.addEventListener("bitpix:toast", onToast as EventListener);
    return () => window.removeEventListener("bitpix:toast", onToast as EventListener);
  }, []);

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`toast toast-${item.kind}`}>
          {item.kind === "success" ? <CheckCircle2 size={18} /> : item.kind === "error" ? <TriangleAlert size={18} /> : <Info size={18} />}
          <span>{item.message}</span>
          <button type="button" onClick={() => setToasts((current) => current.filter((toastItem) => toastItem.id !== item.id))} aria-label="Fechar"><X size={15} /></button>
        </div>
      ))}
    </div>
  );
}
