import type { LucideIcon } from "lucide-react";

export function PhasePage({
  eyebrow,
  title,
  description,
  icon: Icon,
  next,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  next: string;
}) {
  return (
    <div className="page-container">
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--primary)]">{eyebrow}</p>
      <h1 className="display-title">{title}</h1>
      <p className="mt-3 max-w-2xl text-lg text-[var(--ink-muted)]">{description}</p>
      <section className="card mt-9 max-w-3xl overflow-hidden">
        <div className="grid sm:grid-cols-[160px_1fr]">
          <div className="grid min-h-44 place-items-center border-b border-[var(--border)] bg-[var(--surface-subtle)] sm:border-b-0 sm:border-r">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]"><Icon size={29} strokeWidth={1.7} /></span>
          </div>
          <div className="p-7 sm:p-9">
            <h2 className="font-[var(--font-display)] text-xl font-semibold tracking-[-0.025em]">Base pronta para evoluir</h2>
            <p className="mt-3 leading-relaxed text-[var(--ink-muted)]">{next}</p>
            <div className="mt-6 flex items-center gap-2 text-sm font-bold text-[var(--success)]"><span className="status-dot" /> Rota protegida e separada</div>
          </div>
        </div>
      </section>
    </div>
  );
}
