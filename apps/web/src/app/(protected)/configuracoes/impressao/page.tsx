import { redirect } from "next/navigation";
import { PrintSettings } from "@/features/settings/print-settings";
import { apiFetch, requireSession } from "@/lib/server-api";
export default async function PrintPage(){const principal=await requireSession();if(!principal.permissions.includes("print.settings.read"))redirect("/configuracoes");const template=(await apiFetch<{data:Parameters<typeof PrintSettings>[0]["initial"]}>("/print-template")).data;return <div className="page-container management-page"><div className="management-heading"><div><p className="eyebrow">Personalização</p><h1 className="display-title">Impressão</h1><p>Monte o cupom como quiser e veja o resultado na hora — nome, logo, mensagens, campos e papel 58/80 mm.</p></div></div><PrintSettings initial={template}/></div>}
