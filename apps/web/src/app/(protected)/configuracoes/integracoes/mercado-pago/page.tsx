import type { ProviderIntegrationDto } from "@bitpix/contracts";
import type { Metadata } from "next";
import { ArrowLeft, Landmark } from "lucide-react";
import Link from "next/link";
import { MercadoPagoSettings } from "@/features/integrations/mercado-pago-settings";
import { apiFetch } from "@/lib/server-api";

export const metadata: Metadata = { title: "Mercado Pago" };

export default async function MercadoPagoPage() {
  const integration = await apiFetch<{ data: ProviderIntegrationDto }>("/integrations/mercado-pago");
  return <div className="page-container"><Link href="/configuracoes" className="integration-back"><ArrowLeft size={17} /> Configurações</Link><div className="integration-page-heading"><div><p className="cash-kicker">Configurações · Integrações</p><h1 className="display-title">Mercado Pago</h1><p>Conecte a conta responsável pelas cobranças Pix desta empresa.</p></div><span><Landmark size={25} /></span></div><MercadoPagoSettings initial={integration.data} /></div>;
}
