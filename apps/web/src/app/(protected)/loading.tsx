// Skeleton exibido enquanto o servidor busca os dados da página (SSR). Evita o
// "flash" em branco entre navegações — sensação de app rápido e polido.
export default function ProtectedLoading() {
  return (
    <div className="page-container" aria-hidden="true">
      <div className="skeleton-block" style={{ height: 34, width: "34%", marginBottom: 12 }} />
      <div className="skeleton-block" style={{ height: 16, width: "52%", marginBottom: 28 }} />
      <div className="skeleton-grid">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton-card" />)}
      </div>
      <div className="skeleton-block" style={{ height: 320, marginTop: 20, borderRadius: 18 }} />
    </div>
  );
}
