"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Seletor de atendente para gestão admin. Preserva os demais filtros da URL e
// navega ao trocar — reaproveitável em Dashboard e outras telas de análise.
export function OperatorFilter({ operators, current }: { operators: Array<{ publicId: string; name: string }>; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (operators.length === 0) return null;

  const onChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("operator", value); else params.delete("operator");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <label className="operator-filter">
      <span>Atendente</span>
      <select className="field-input" value={current} onChange={(event) => onChange(event.target.value)}>
        <option value="">Geral (todos)</option>
        {operators.map((operator) => <option key={operator.publicId} value={operator.publicId}>{operator.name}</option>)}
      </select>
    </label>
  );
}
