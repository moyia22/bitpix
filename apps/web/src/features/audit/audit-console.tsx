"use client";

import { Banknote, CheckCircle2, Eye, Fingerprint, Search, Settings2, ShieldCheck, Undo2, User, WalletCards, X, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { actionGroup, describeAction } from "./audit-labels";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });

interface AuditItem { publicId: string; action: string; entity: string; entityPublicId: string | null; outcome: "SUCCESS" | "FAILURE"; correlationId: string | null; ipAddress: string | null; createdAt: string; actor: { name: string } | null; branch: { name: string } | null }
interface AuditDetail extends AuditItem { userAgent: string | null; before: unknown; after: unknown; metadata: unknown; actor: { name: string; email: string } | null }
interface Pagination { page: number; pageSize: number; total: number; totalPages: number }

const groupIcon = { auth: Fingerprint, pix: Banknote, cash: WalletCards, refund: Undo2, user: User, config: Settings2, other: ShieldCheck } as const;

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, { credentials: "include" });
  if (!response.ok) throw new Error("Não foi possível carregar.");
  return response.json() as Promise<T>;
}

export function AuditConsole({ initial, pagination, canReadDetails }: { initial: AuditItem[]; pagination: Pagination; canReadDetails: boolean }) {
  const [rows, setRows] = useState(initial);
  const [page, setPage] = useState(pagination);
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [error, setError] = useState("");

  const load = async (nextPage = 1) => {
    setBusy(true); setError("");
    const params = new URLSearchParams({ page: String(nextPage), pageSize: "20", ...(search ? { action: search } : {}), ...(outcome ? { outcome } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
    try {
      const body = await request<{ data: AuditItem[]; pagination: Pagination }>(`/audit?${params}`);
      setRows(body.data); setPage(body.pagination);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao consultar."); } finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void load(1); };
  const openDetail = async (publicId: string) => {
    if (!canReadDetails) return;
    setBusy(true);
    try { setDetail((await request<{ data: AuditDetail }>(`/audit/${publicId}`)).data); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao abrir o registro."); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <form className="card audit-filters" onSubmit={submit}>
        <label className="audit-search"><span>Buscar ação</span><div><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ex.: login, estorno, cobrança" /></div></label>
        <label><span>Resultado</span><select className="field-input" value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">Todos</option><option value="SUCCESS">Sucesso</option><option value="FAILURE">Falha</option></select></label>
        <label><span>De</span><input className="field-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>Até</span><input className="field-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button className="primary-button" disabled={busy} type="submit"><Search size={17} /> Filtrar</button>
      </form>
      {error && <div className="cash-notice cash-notice-error" role="alert">{error}</div>}

      <section className="card audit-list">
        {rows.length === 0 ? <p className="cash-empty">Nenhum registro encontrado com estes filtros.</p> : rows.map((log) => {
          const Icon = groupIcon[actionGroup(log.action)];
          return (
            <article key={log.publicId} className="audit-row" data-outcome={log.outcome} data-clickable={canReadDetails} onClick={() => canReadDetails && void openDetail(log.publicId)}>
              <span className={`audit-icon ${log.outcome === "FAILURE" ? "is-fail" : ""}`}><Icon size={18} /></span>
              <div className="audit-main">
                <strong>{describeAction(log.action)}</strong>
                <span>{log.actor?.name ?? "Sistema"}{log.branch?.name ? ` · ${log.branch.name}` : ""}{log.ipAddress ? ` · ${log.ipAddress}` : ""}</span>
              </div>
              <span className={`audit-badge ${log.outcome === "SUCCESS" ? "ok" : "fail"}`}>{log.outcome === "SUCCESS" ? <CheckCircle2 size={13} /> : <XCircle size={13} />}{log.outcome === "SUCCESS" ? "Sucesso" : "Falha"}</span>
              <time dateTime={log.createdAt}>{dateTime.format(new Date(log.createdAt))}</time>
              {canReadDetails && <span className="audit-open"><Eye size={16} /></span>}
            </article>
          );
        })}
        <div className="cash-pagination">
          <button type="button" disabled={page.page <= 1 || busy} onClick={() => void load(page.page - 1)}>Anterior</button>
          <span>Página {page.page} de {Math.max(1, page.totalPages)} · {page.total} registro{page.total === 1 ? "" : "s"}</span>
          <button type="button" disabled={page.page >= page.totalPages || busy} onClick={() => void load(page.page + 1)}>Próxima</button>
        </div>
      </section>

      {detail && (
        <div className="history-modal" role="dialog" aria-modal="true" aria-label="Detalhe da auditoria" onClick={() => setDetail(null)}>
          <div className="card history-detail" onClick={(event) => event.stopPropagation()}>
            <div className="cash-panel-heading"><div><p className="cash-kicker">Registro {detail.publicId.slice(0, 8)}</p><h2>{describeAction(detail.action)}</h2></div><button className="icon-button" type="button" onClick={() => setDetail(null)} aria-label="Fechar"><X size={18} /></button></div>
            <div className="history-detail-grid">
              <span>Resultado <strong>{detail.outcome === "SUCCESS" ? "Sucesso" : "Falha"}</strong></span>
              <span>Quem <strong>{detail.actor?.name ?? "Sistema"}</strong></span>
              <span>E-mail <strong>{detail.actor?.email ?? "—"}</strong></span>
              <span>Quando <strong>{dateTime.format(new Date(detail.createdAt))}</strong></span>
              <span>Entidade <strong>{detail.entity}</strong></span>
              <span>Filial <strong>{detail.branch?.name ?? "—"}</strong></span>
              <span>IP <strong>{detail.ipAddress ?? "—"}</strong></span>
              <span>Correlação <strong>{detail.correlationId?.slice(0, 8) ?? "—"}</strong></span>
            </div>
            {Boolean(detail.before || detail.after) && (
              <div className="audit-diff">
                <div><h3>Antes</h3><pre>{detail.before ? JSON.stringify(detail.before, null, 2) : "—"}</pre></div>
                <div><h3>Depois</h3><pre>{detail.after ? JSON.stringify(detail.after, null, 2) : "—"}</pre></div>
              </div>
            )}
            {detail.metadata ? <><h3 className="mt-4 font-semibold">Detalhes</h3><pre className="audit-meta">{JSON.stringify(detail.metadata, null, 2)}</pre></> : null}
          </div>
        </div>
      )}
    </div>
  );
}
