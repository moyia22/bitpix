import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PasswordChange } from "@/features/auth/password-change";
import { requireSession } from "@/lib/server-api";

export const metadata: Metadata = { title: "Alterar senha" };

export default async function SenhaPage() {
  const principal = await requireSession();
  return (
    <div className="page-container">
      {!principal.mustResetPassword && <Link href="/configuracoes" className="integration-back"><ArrowLeft size={17} /> Configurações</Link>}
      <div className="integration-page-heading">
        <div>
          <p className="cash-kicker">Configurações · Segurança</p>
          <h1 className="display-title">Alterar senha</h1>
          <p>{principal.mustResetPassword ? "Sua senha precisa ser redefinida antes de continuar." : "Atualize a senha da sua conta."}</p>
        </div>
      </div>
      <PasswordChange forced={principal.mustResetPassword} />
    </div>
  );
}
