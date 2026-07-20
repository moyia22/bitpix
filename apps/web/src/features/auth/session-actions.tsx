"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export function SessionActions() {
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const revokeOthers = async () => {
    setStatus("busy");
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/sessions/revoke-others`, { method: "POST", credentials: "include" });
      setStatus(response.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div>
      <button type="button" className="primary-button" onClick={revokeOthers} disabled={status === "busy"}>
        {status === "busy" ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
        Encerrar outras sessões
      </button>
      {status === "done" && <p role="status" className="mt-3 text-sm font-semibold text-[var(--success)]">Outras sessões foram revogadas.</p>}
      {status === "error" && <p role="alert" className="mt-3 text-sm font-semibold text-[var(--danger)]">Não foi possível revogar as sessões.</p>}
    </div>
  );
}
