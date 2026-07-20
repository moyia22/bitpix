import type { Metadata } from "next";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main id="conteudo-principal" className="grid min-h-screen lg:grid-cols-[minmax(360px,0.82fr)_1.18fr]">
      <section className="relative hidden overflow-hidden bg-[var(--navy)] px-12 py-10 text-white lg:flex lg:flex-col">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-28 h-[28rem] w-[28rem] rounded-full opacity-70 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(124,107,245,0.55), transparent 70%)", animation: "soft-float 7s ease-in-out infinite" }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-[-6rem] top-1/3 h-80 w-80 rounded-full opacity-55 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(52,216,194,0.42), transparent 70%)", animation: "soft-float 9s ease-in-out infinite reverse" }}
        />
        <div className="relative z-10 [&_*]:text-white"><BrandMark /></div>
        <div className="relative z-10 my-auto max-w-lg pb-10" style={{ animation: "reveal-up 0.6s var(--ease-out) both" }}>
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.16em] text-[#aaa5f7]">Precisão de balcão</p>
          <h1 className="font-[var(--font-display)] text-[clamp(2.7rem,5vw,5rem)] font-semibold leading-[0.98] tracking-[-0.05em]">
            Cobrar bem<br />
            <span style={{ background: "linear-gradient(120deg,#9d8bff,#34d8c2)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>é cobrar simples.</span>
          </h1>
          <p className="mt-7 max-w-md text-lg leading-relaxed text-[#b9c1d3]">
            Uma operação limpa, segura e preparada para cada Pix no ritmo da sua loja.
          </p>
        </div>
        <div className="relative z-10 flex flex-wrap items-center gap-2 text-sm text-[#9da8bd]">
          {["Código", "Valor", "Pix", "Pago"].map((step, index) => (
            <span key={step} className="flex items-center gap-2">
              <span className="rounded-full border border-[#39415c] bg-[#1c2440] px-3 py-1 font-semibold text-[#c9d0e2]">{step}</span>
              {index < 3 && <span className="text-[#5f6c88]" aria-hidden="true">→</span>}
            </span>
          ))}
        </div>
        <div className="absolute -bottom-32 -right-24 h-96 w-96 rounded-full border border-[#303a55]" aria-hidden="true" style={{ animation: "soft-float 11s ease-in-out infinite" }} />
        <div className="absolute -bottom-16 -right-8 h-64 w-64 rounded-full border border-[#3e4760]" aria-hidden="true" style={{ animation: "soft-float 8s ease-in-out infinite reverse" }} />
      </section>

      <section className="flex items-center justify-center bg-transparent px-5 py-12 sm:px-10">
        <div className="w-full max-w-[430px]" style={{ animation: "reveal-up 0.5s var(--ease-out) 0.1s both" }}>
          <div className="mb-12 lg:hidden"><BrandMark /></div>
          <span className="dev-badge mb-7"><span className="status-dot" /> Ambiente de desenvolvimento</span>
          <h2 className="display-title">Bem-vindo de volta</h2>
          <p className="mt-3 text-[var(--ink-muted)]">Entre com sua conta para acessar o caixa da loja.</p>
          <LoginForm />
          <p className="mt-8 border-t border-[var(--border)] pt-6 text-sm leading-relaxed text-[var(--ink-faint)]">
            Acesso restrito. Suas sessões são protegidas e podem ser revogadas a qualquer momento.
          </p>
        </div>
      </section>
    </main>
  );
}
