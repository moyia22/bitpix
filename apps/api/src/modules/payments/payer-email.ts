import { AppError } from "../../lib/errors.js";

// TLDs reservados/não roteáveis (RFC 2606/6761 + mDNS .local). O Mercado Pago
// recusa esses domínios com invalid_payer_email — nunca podem virar payer.email.
const RESERVED_TLDS = new Set(["local", "localhost", "test", "example", "invalid"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Um e-mail só é aceito como pagador do Pix se tiver forma válida E domínio real.
export function isValidPayerEmail(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 180) return false;
  if (!EMAIL_RE.test(email)) return false;
  const domain = email.slice(email.indexOf("@") + 1);
  if (!domain.includes(".")) return false; // exige TLD
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  return !RESERVED_TLDS.has(tld);
}

// Resolve o e-mail do pagador na prioridade correta:
//   1) e-mail informado pelo cliente na venda;
//   2) e-mail válido configurado da empresa;
// Nunca aceita *.local. Se nenhum for válido, bloqueia a cobrança com erro claro
// (o chamador NÃO deve enviar nada ao Mercado Pago nesse caso).
export function resolvePayerEmail(sources: { customerEmail?: string | null | undefined; companyEmail?: string | null | undefined }): string {
  for (const candidate of [sources.customerEmail, sources.companyEmail]) {
    if (isValidPayerEmail(candidate)) return candidate.trim().toLowerCase();
  }
  throw new AppError(
    422,
    "PAYER_EMAIL_REQUIRED",
    "Informe um e-mail válido do cliente ou configure o e-mail Pix da empresa. E-mails de domínio .local não são aceitos pelo Mercado Pago.",
  );
}
