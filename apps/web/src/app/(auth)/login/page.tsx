import type { Metadata } from "next";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main id="conteudo-principal" className="grid min-h-screen lg:grid-cols-[minmax(360px,0.82fr)_1.18fr]">
      <section className="relative hidden overflow-hidden bg-[var(--navy)] px-12 py-10 text-white lg:flex lg:flex-col">
        <div className="relative z-10 [&_*]:text-white"><BrandMark /></div>
        <div className="relative z-10 my-auto max-w-lg pb-10">
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.16em] text-[#aaa5f7]">Precisão de balcão</p>
          <h1 className="font-[var(--font-display)] text-[clamp(2.7rem,5vw,5rem)] font-semibold leading-[0.98] tracking-[-0.05em]">
            Cobrar bem<br />é cobrar simples.
          </h1>
          <p className="mt-7 max-w-md text-lg leading-relaxed text-[#b9c1d3]">
            Uma operação limpa, segura e preparada para cada Pix no ritmo da sua loja.
          </p>
        </div>
        <div className="relative z-10 flex items-center gap-3 text-sm text-[#9da8bd]">
          <span className="h-px w-12 bg-[#6257d9]" /> Código <span className="text-[#69758c]">→</span> Valor <span className="text-[#69758c]">→</span> Pix <span className="text-[#69758c]">→</span> Pago
        </div>
        <div className="absolute -bottom-32 -right-24 h-96 w-96 rounded-full border border-[#303a55]" aria-hidden="true" />
        <div className="absolute -bottom-16 -right-8 h-64 w-64 rounded-full border border-[#3e4760]" aria-hidden="true" />
      </section>

      <section className="flex items-center justify-center bg-[var(--background)] px-5 py-12 sm:px-10">
        <div className="w-full max-w-[430px]">
          <div className="mb-12 lg:hidden"><BrandMark /></div>
          <span className="dev-badge mb-7"><span className="status-dot" /> Ambiente de desenvolvimento</span>
          <h2 className="display-title">Bem-vindo de volta</h2>
          <p className="mt-3 text-[var(--ink-muted)]">Entre com sua conta para acessar o caixa da loja.</p>
          <LoginForm />
          <p className="mt-8 border-t border-[var(--border)] pt-6 text-sm leading-relaxed text-[var(--ink-faint)]">
            Ambiente com provider simulado: confirmações reais exigem credencial e webhook oficiais configurados.
          </p>
        </div>
      </section>
    </main>
  );
}
