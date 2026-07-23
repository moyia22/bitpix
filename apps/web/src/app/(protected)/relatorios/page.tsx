import { redirect } from "next/navigation";
import { ReportConsole } from "@/features/reports/report-console";
import { apiFetch, requireSession } from "@/lib/server-api";
const validTypes = ["sales","payments","charges","closing","cash-sessions","cash-movements","reconciliation"] as const;
type ReportType = typeof validTypes[number];
interface OperatorOption { publicId: string; name: string }
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{type?:string;from?:string;to?:string;search?:string;operator?:string}> }) {
  const principal=await requireSession(); if(!principal.permissions.includes("reports.view")&&!principal.permissions.includes("reports.sales.read"))redirect("/nova-venda");
  const query=await searchParams; const type:ReportType=validTypes.includes(query.type as ReportType)?query.type as ReportType:"sales"; const today=new Date(); const start=new Date(today); start.setDate(today.getDate()-29); const from=query.from??start.toISOString().slice(0,10); const to=query.to??today.toISOString().slice(0,10); const search=query.search??""; const operator=query.operator??"";
  const canFilterByOperator = principal.permissions.includes("users.read") || principal.permissions.includes("users.manage");
  const params=new URLSearchParams({page:"1",pageSize:"50",from,to,...(search?{search}:{}),...(operator?{operatorPublicId:operator}:{})});
  const [response, operators] = await Promise.all([
    apiFetch<{data:Array<Record<string,string|number|null>>;pagination:{total:number}}>(`/reports/${type}?${params}`),
    canFilterByOperator ? apiFetch<{data:OperatorOption[]}>("/users?pageSize=50").then((body)=>body.data.map((user)=>({publicId:user.publicId,name:user.name}))) : Promise.resolve<OperatorOption[]>([]),
  ]);
  return <div className="page-container management-page"><div className="management-heading"><div><p className="eyebrow">Análise operacional</p><h1 className="display-title">Relatórios</h1><p>Dados paginados no servidor, isolados por empresa e prontos para exportação.</p></div></div><ReportConsole type={type} rows={response.data} total={response.pagination.total} initialSearch={search} from={from} to={to} operators={operators} operator={operator}/></div>;
}
