"use client";
import { ImageUp, LoaderCircle, QrCode, Save } from "lucide-react";
import Image from "next/image";
import { useState, type ChangeEvent } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

type Template = { storeName: string; title: string; messageAboveQr: string | null; messageBelowQr: string | null; footer: string | null; paperWidth: "MM58" | "MM80"; qrSize: number; alignment: "LEFT" | "CENTER" | "RIGHT"; showSaleCode: boolean; showAmount: boolean; showPixCopyPaste: boolean; showDate: boolean; showTime: boolean; showExpiration: boolean; showOperator: boolean; showCashRegister: boolean; showTransactionId: boolean; showNonFiscalDisclaimer: boolean; copies: number; cutSpacingMm: number; autoPrint: boolean; printAfterConfirmation: boolean; autoReturnToSale: boolean; paymentSoundEnabled: boolean; logoFile: { originalName: string | null } | null };

const fieldLabels: Record<string, string> = { showSaleCode: "Código da venda", showAmount: "Valor", showPixCopyPaste: "Pix copia e cola", showDate: "Data", showTime: "Hora", showExpiration: "Expiração", showOperator: "Operador", showCashRegister: "Caixa", showTransactionId: "ID da transação", showNonFiscalDisclaimer: "Aviso “não fiscal”" };
const automationLabels: Record<string, string> = { autoPrint: "Impressão automática", printAfterConfirmation: "Imprimir após confirmação", autoReturnToSale: "Retornar para venda", paymentSoundEnabled: "Som de pagamento" };
const alignMap = { LEFT: "left", CENTER: "center", RIGHT: "right" } as const;

export function PrintSettings({ initial }: { initial: Template }) {
  const [t, setT] = useState<Template>(initial);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const set = <K extends keyof Template>(key: K, value: Template[K]) => setT((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true); setNotice("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/print-template`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...t, messageAboveQr: t.messageAboveQr || null, messageBelowQr: t.messageBelowQr || null, footer: t.footer || null }) });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Falha ao salvar.");
      setNotice("Modelo de impressão salvo.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao salvar."); } finally { setSaving(false); }
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setSaving(true); setNotice("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      setLogoPreview(dataUrl);
      const response = await fetch(`${apiUrl}/api/v1/print-template/logo`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64: dataUrl.split(",")[1] ?? "" }) });
      if (!response.ok) { const body = await response.json() as { error?: { message?: string } }; throw new Error(body.error?.message ?? "Imagem inválida."); }
      set("logoFile", { originalName: file.name });
      setNotice("Logomarca validada e salva.");
    } catch (error) { setLogoPreview(null); setNotice(error instanceof Error ? error.message : "Imagem inválida."); } finally { setSaving(false); event.target.value = ""; }
  };

  const align = alignMap[t.alignment];
  const sample = { amount: "R$ 12,50", code: "PED-1048", date: "23/07/2026", time: "13:45", expiration: "29:30", operator: "Maria", cashRegister: "Caixa 01 · CX-01", transaction: "PAY0••••2SRE" };

  return (
    <div className="print-editor">
      <div className="print-editor-controls">
        <section className="print-group">
          <h3>Identidade</h3>
          <label className="field-label">Nome da loja<input className="field-input" value={t.storeName} maxLength={120} onChange={(event) => set("storeName", event.target.value)} /></label>
          <label className="field-label">Título<input className="field-input" value={t.title} maxLength={120} onChange={(event) => set("title", event.target.value)} /></label>
          <label className="secondary-button file-button"><ImageUp size={17} /> {t.logoFile?.originalName ?? "Enviar logomarca"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadLogo(event)} /></label>
        </section>

        <section className="print-group">
          <h3>Mensagens</h3>
          <label className="field-label">Acima do QR<input className="field-input" value={t.messageAboveQr ?? ""} maxLength={240} placeholder="Ex.: Escaneie para pagar" onChange={(event) => set("messageAboveQr", event.target.value)} /></label>
          <label className="field-label">Abaixo do QR<input className="field-input" value={t.messageBelowQr ?? ""} maxLength={240} placeholder="Ex.: Obrigado pela preferência" onChange={(event) => set("messageBelowQr", event.target.value)} /></label>
          <label className="field-label">Rodapé<input className="field-input" value={t.footer ?? ""} maxLength={300} onChange={(event) => set("footer", event.target.value)} /></label>
        </section>

        <section className="print-group">
          <h3>Layout</h3>
          <div className="print-inline">
            <label className="field-label">Largura do papel
              <div className="print-toggle">
                {(["MM58", "MM80"] as const).map((w) => <button type="button" key={w} data-active={t.paperWidth === w} onClick={() => set("paperWidth", w)}>{w === "MM58" ? "58 mm" : "80 mm"}</button>)}
              </div>
            </label>
            <label className="field-label">Alinhamento
              <div className="print-toggle">
                {(["LEFT", "CENTER", "RIGHT"] as const).map((a) => <button type="button" key={a} data-active={t.alignment === a} onClick={() => set("alignment", a)}>{a === "LEFT" ? "◧" : a === "CENTER" ? "▣" : "◨"}</button>)}
              </div>
            </label>
          </div>
          <label className="field-label">Tamanho do QR: <strong>{t.qrSize}px</strong><input type="range" min={120} max={420} value={t.qrSize} onChange={(event) => set("qrSize", Number(event.target.value))} /></label>
          <div className="print-inline">
            <label className="field-label">Cópias<input className="field-input" type="number" min={1} max={3} value={t.copies} onChange={(event) => set("copies", Number(event.target.value))} /></label>
            <label className="field-label">Espaço de corte (mm)<input className="field-input" type="number" min={0} max={40} value={t.cutSpacingMm} onChange={(event) => set("cutSpacingMm", Number(event.target.value))} /></label>
          </div>
        </section>

        <section className="print-group">
          <h3>Campos exibidos</h3>
          <div className="switch-grid">
            {(Object.keys(fieldLabels) as Array<keyof Template>).map((key) => <label className="check-row" key={key}><input type="checkbox" checked={t[key] as boolean} onChange={(event) => set(key, event.target.checked as Template[typeof key])} /><span>{fieldLabels[key]}</span></label>)}
          </div>
        </section>

        <section className="print-group">
          <h3>Automações</h3>
          <div className="switch-grid">
            {(Object.keys(automationLabels) as Array<keyof Template>).map((key) => <label className="check-row" key={key}><input type="checkbox" checked={t[key] as boolean} onChange={(event) => set(key, event.target.checked as Template[typeof key])} /><span>{automationLabels[key]}</span></label>)}
          </div>
        </section>

        {notice && <p className="inline-notice">{notice}</p>}
        <button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Salvar modelo</button>
      </div>

      <aside className="print-editor-preview">
        <p className="print-preview-hint">Pré-visualização ao vivo</p>
        <div className="print-preview" data-width={t.paperWidth} style={{ textAlign: align }}>
          {(logoPreview || t.logoFile) && (logoPreview ? <Image src={logoPreview} alt="Logo" width={200} height={120} className="pp-logo" unoptimized /> : <div className="pp-logo-name">🖼️ {t.logoFile?.originalName}</div>)}
          <h1 className="pp-store">{t.storeName || "Nome da loja"}</h1>
          <p className="pp-title">{t.title || "Cobrança Pix"}</p>
          {t.messageAboveQr && <p className="pp-msg">{t.messageAboveQr}</p>}
          {t.showAmount && <strong className="pp-amount">{sample.amount}</strong>}
          <div className="pp-qr" style={{ margin: align === "center" ? "10px auto" : "10px 0" }}>
            <QrCode size={Math.max(72, Math.min(180, t.qrSize / 2.4))} strokeWidth={1.2} />
          </div>
          {t.showPixCopyPaste && <p className="pp-code">00020126360014BR.GOV.BCB.PIX0114+55…5204000053039865802BR</p>}
          {t.messageBelowQr && <p className="pp-msg">{t.messageBelowQr}</p>}
          <div className="pp-lines">
            {t.showSaleCode && <span>Venda: {sample.code}</span>}
            {t.showDate && <span>Data: {sample.date}</span>}
            {t.showTime && <span>Hora: {sample.time}</span>}
            {t.showExpiration && <span>Expira em: {sample.expiration}</span>}
            {t.showOperator && <span>Operador: {sample.operator}</span>}
            {t.showCashRegister && <span>{sample.cashRegister}</span>}
            {t.showTransactionId && <span>Transação: {sample.transaction}</span>}
          </div>
          {t.footer && <p className="pp-footer">{t.footer}</p>}
          {t.showNonFiscalDisclaimer && <b className="pp-nonfiscal">Documento não fiscal</b>}
        </div>
      </aside>
    </div>
  );
}
