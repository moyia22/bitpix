import type { Metadata } from "next";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { MfaSetup } from "@/features/auth/mfa-setup";
import { apiFetch } from "@/lib/server-api";

export const metadata: Metadata = { title: "Segurança" };

export default async function SegurancaPage() {
  const status = await apiFetch<{ data: { enabled: boolean } }>("/auth/mfa/status");
  return (
    <div className="page-container">
      <Link href="/configuracoes" className="integration-back"><ArrowLeft size={17} /> Configurações</Link>
      <div className="integration-page-heading">
        <div>
          <p className="cash-kicker">Configurações · Segurança</p>
          <h1 className="display-title">Segurança</h1>
          <p>Gerencie a autenticação de dois fatores da sua conta.</p>
        </div>
        <span><ShieldCheck size={25} /></span>
      </div>
      <MfaSetup initialEnabled={status.data.enabled} />
    </div>
  );
}
