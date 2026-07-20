import { CheckCircle2, XCircle } from "lucide-react";
import { redirect } from "next/navigation";
import { apiFetch, requireSession } from "@/lib/server-api";

interface AuditItem { publicId: string; action: string; entity: string; outcome: "SUCCESS" | "FAILURE"; createdAt: string; actor: { name: string } | null }

export default async function AuditPage() {
  const principal = await requireSession();
  if (!principal.permissions.includes("audit.read")) redirect("/nova-venda");
  const logs = await apiFetch<{ data: AuditItem[] }>("/audit");
  return (
    <div className="page-container">
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--primary)]">Segurança</p>
      <h1 className="display-title">Auditoria</h1>
      <p className="mt-3 text-[var(--ink-muted)]">Ações sensíveis registradas de forma imutável no escopo da empresa.</p>
      <div className="card mt-9 divide-y divide-[var(--border)] overflow-hidden">
        {logs.data.map((log) => (
          <article key={log.publicId} className="flex flex-wrap items-center gap-4 px-6 py-4">
            <span className={`grid h-10 w-10 place-items-center rounded-xl ${log.outcome === "SUCCESS" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>
              {log.outcome === "SUCCESS" ? <CheckCircle2 size={19} /> : <XCircle size={19} />}
            </span>
            <div className="min-w-0 flex-1"><strong className="block truncate">{log.action}</strong><span className="text-sm text-[var(--ink-muted)]">{log.entity} · {log.actor?.name ?? "Sistema"}</span></div>
            <time className="text-sm text-[var(--ink-faint)]" dateTime={log.createdAt}>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(log.createdAt))}</time>
          </article>
        ))}
      </div>
    </div>
  );
}
