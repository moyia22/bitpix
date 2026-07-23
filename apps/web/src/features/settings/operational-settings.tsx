"use client";
import { LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

interface QuickItem { name: string; amountInCents: number }
type Settings = { displayName: string; timezone: string; defaultPixExpirationMinutes: number; confirmBeforePix: boolean; blockDuplicateCode: boolean; autoPrint: boolean; printAfterConfirmation: boolean; autoReturnToSale: boolean; autoReturnSeconds: number; blockCloseWithPendingCharges: boolean; minSaleAmountInCents: number; maxSaleAmountInCents: number; pixPayerEmail: string; quickItems?: QuickItem[]; pixReviewAmountInCents?: number; pixBlockAmountInCents?: number; paymentSoundEnabled: boolean };

interface ItemDraft { name: string; amount: string }

export function OperationalSettings({ initial }: { initial: Settings }) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [items, setItems] = useState<ItemDraft[]>((initial.quickItems ?? []).map((item) => ({ name: item.name, amount: (item.amountInCents / 100).toFixed(2) })));

  const addItem = () => setItems((current) => [...current, { name: "", amount: "" }]);
  const removeItem = (index: number) => setItems((current) => current.filter((_, position) => position !== index));
  const updateItem = (index: number, field: keyof ItemDraft, value: string) => setItems((current) => current.map((item, position) => position === index ? { ...item, [field]: value } : item));

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setNotice("");
    const data = new FormData(event.currentTarget);
    const quickItems = items
      .map((item) => ({ name: item.name.trim(), amountInCents: Math.round(Number(item.amount.replace(",", ".")) * 100) }))
      .filter((item) => item.name.length > 0 && item.amountInCents > 0);
    const body = { displayName: String(data.get("displayName")), timezone: String(data.get("timezone")), defaultPixExpirationMinutes: Number(data.get("expiration")), confirmBeforePix: data.has("confirm"), blockDuplicateCode: data.has("duplicate"), autoPrint: data.has("autoPrint"), printAfterConfirmation: data.has("printConfirmation"), autoReturnToSale: data.has("autoReturn"), autoReturnSeconds: Number(data.get("returnSeconds")), blockCloseWithPendingCharges: data.has("pendingClose"), minSaleAmountInCents: Math.round(Number(data.get("min")) * 100), maxSaleAmountInCents: Math.round(Number(data.get("max")) * 100), pixPayerEmail: String(data.get("payerEmail") ?? "").trim(), quickItems, pixReviewAmountInCents: Math.round(Number(data.get("reviewAmount") || 0) * 100), pixBlockAmountInCents: Math.round(Number(data.get("blockAmount") || 0) * 100), paymentSoundEnabled: data.has("sound") };
    try {
      const response = await fetch(`${apiUrl}/api/v1/settings`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Falha ao salvar.");
      setNotice("Configurações salvas e registradas na auditoria.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao salvar."); } finally { setSaving(false); }
  };

  return (
    <form className="card settings-form" onSubmit={save}>
      <div className="form-grid">
        <label><span>Nome de exibição</span><input name="displayName" defaultValue={initial.displayName} required /></label>
        <label><span>Fuso horário</span><input name="timezone" defaultValue={initial.timezone} required /></label>
        <label><span>Expiração padrão do Pix (minutos)</span><input name="expiration" type="number" min="30" max="43200" defaultValue={initial.defaultPixExpirationMinutes} /></label>
        <label><span>Retorno automático (segundos)</span><input name="returnSeconds" type="number" min="1" max="120" defaultValue={initial.autoReturnSeconds} /></label>
        <label><span>Venda mínima (R$)</span><input name="min" type="number" min=".01" step=".01" defaultValue={(initial.minSaleAmountInCents / 100).toFixed(2)} /></label>
        <label><span>Venda máxima (R$)</span><input name="max" type="number" min=".01" step=".01" defaultValue={(initial.maxSaleAmountInCents / 100).toFixed(2)} /></label>
        <label><span>E-mail Pix da empresa (pagador padrão)</span><input name="payerEmail" type="email" defaultValue={initial.pixPayerEmail} placeholder="pagador@suaempresa.com.br" /><small className="field-hint">Usado quando o cliente não informa e-mail. Domínio real — <strong>.local</strong> é recusado pelo Mercado Pago.</small></label>
        <label><span>Avisar Pix acima de (R$)</span><input name="reviewAmount" type="number" min="0" step=".01" defaultValue={((initial.pixReviewAmountInCents ?? 0) / 100).toFixed(2)} placeholder="0,00 (desativado)" /><small className="field-hint">Acima deste valor, a tela avisa para checar se o cliente pode receber direto na conta (sem taxa) — mas ainda permite gerar. 0 = sem aviso.</small></label>
        <label><span>Bloquear Pix acima de (R$)</span><input name="blockAmount" type="number" min="0" step=".01" defaultValue={((initial.pixBlockAmountInCents ?? 0) / 100).toFixed(2)} placeholder="0,00 (sem limite)" /><small className="field-hint">Acima deste valor, o Pix <strong>não</strong> é gerado (receba diretamente na conta). 0 = sem limite. Deve ser ≥ o valor de aviso.</small></label>
      </div>

      <div className="catalog-editor">
        <div className="catalog-editor-head"><div><strong>Catálogo rápido</strong><small>Produtos/valores tocáveis no balcão (ex.: Café · R$ 5,00).</small></div><button type="button" className="cash-secondary-button" onClick={addItem}><Plus size={15} /> Adicionar item</button></div>
        {items.length === 0 ? (
          <p className="catalog-empty">Nenhum item. Adicione atalhos para agilizar as vendas.</p>
        ) : (
          <ul className="catalog-rows">
            {items.map((item, index) => (
              <li key={index}>
                <input aria-label="Nome do item" value={item.name} maxLength={40} placeholder="Nome (ex.: Café)" onChange={(event) => updateItem(index, "name", event.target.value)} />
                <input aria-label="Valor" type="number" min=".01" step=".01" value={item.amount} placeholder="0,00" onChange={(event) => updateItem(index, "amount", event.target.value)} />
                <button type="button" className="icon-button" aria-label="Remover" onClick={() => removeItem(index)}><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="switch-grid">
        <Check name="confirm" label="Confirmar antes de gerar Pix" value={initial.confirmBeforePix} />
        <Check name="duplicate" label="Bloquear código duplicado" value={initial.blockDuplicateCode} />
        <Check name="autoPrint" label="Impressão automática" value={initial.autoPrint} />
        <Check name="printConfirmation" label="Imprimir após confirmação" value={initial.printAfterConfirmation} />
        <Check name="autoReturn" label="Retornar para nova venda" value={initial.autoReturnToSale} />
        <Check name="pendingClose" label="Bloquear fechamento com pendências" value={initial.blockCloseWithPendingCharges} />
        <Check name="sound" label="Som de pagamento" value={initial.paymentSoundEnabled} />
      </div>
      {notice && <p className="inline-notice">{notice}</p>}
      <button className="primary-button" disabled={saving} type="submit">{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Salvar configurações</button>
    </form>
  );
}

function Check({ name, label, value }: { name: string; label: string; value: boolean }) {
  return <label className="check-row"><input type="checkbox" name={name} defaultChecked={value} /><span>{label}</span></label>;
}
