import { CheckCircle2, Circle, PlugZap, Receipt, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/server-api";

interface Readiness { configured: boolean }

// Assistente de configuração inicial: mostra ao admin de uma loja nova o que
// falta para começar a cobrar. Some sozinho quando tudo estiver pronto.
export async function SetupChecklist({ permissions, readiness }: { permissions: readonly string[]; readiness: Readiness }) {
  const canConfigure = permissions.includes("integrations.manage") || permissions.includes("settings.update");
  if (!canConfigure) return null;

  const [settings, users, charges] = await Promise.all([
    apiFetch<{ data: { pixPayerEmail: string } }>("/settings").then((body) => body.data).catch(() => ({ pixPayerEmail: "" })),
    apiFetch<{ pagination: { total: number } }>("/users?pageSize=1").then((body) => body.pagination.total).catch(() => 1),
    apiFetch<{ pagination: { total: number } }>("/pix/charges?pageSize=1").then((body) => body.pagination.total).catch(() => 0),
  ]);

  const steps = [
    { done: readiness.configured, icon: PlugZap, label: "Conectar o Mercado Pago", href: "/configuracoes/integracoes/mercado-pago", hint: "Credencial de produção testada" },
    { done: Boolean(settings.pixPayerEmail), icon: Wallet, label: "Definir o e-mail Pix da empresa", href: "/configuracoes", hint: "Usado como pagador quando o cliente não informa" },
    { done: users > 1, icon: Users, label: "Cadastrar os atendentes", href: "/usuarios", hint: "Cada operador com a própria conta" },
    { done: charges > 0, icon: Receipt, label: "Gerar o primeiro Pix", href: "/nova-venda", hint: "Faça uma cobrança de teste" },
  ];
  const completed = steps.filter((step) => step.done).length;
  if (completed === steps.length) return null; // tudo pronto → não aparece

  return (
    <section className="card setup-checklist" aria-label="Configuração inicial">
      <div className="setup-checklist-head">
        <div>
          <p className="cash-kicker">Primeiros passos</p>
          <h2>Deixe a loja pronta para cobrar</h2>
        </div>
        <span className="setup-progress">{completed}/{steps.length}</span>
      </div>
      <ol className="setup-steps">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li key={step.href} data-done={step.done}>
              <span className="setup-check">{step.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}</span>
              <span className="setup-icon"><Icon size={17} /></span>
              <div><strong>{step.label}</strong><small>{step.hint}</small></div>
              {!step.done && <Link href={step.href} className="cash-secondary-button">Configurar</Link>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
