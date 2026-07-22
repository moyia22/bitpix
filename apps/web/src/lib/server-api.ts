import type { SessionPrincipal } from "@bitpix/contracts";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

const apiUrl = process.env.API_URL ?? "http://localhost:3333";

// Indisponibilidade temporária da API (deploy/restart, 502/503/504, conexão recusada).
// NÃO é falta de autenticação: não desloga o usuário nem manda para /login (evita loop).
export class ApiUnavailableError extends Error {
  constructor(public readonly status?: number) {
    super("Serviço temporariamente indisponível.");
    this.name = "ApiUnavailableError";
  }
}

// Códigos de "gate" do backend → tela correta para o usuário resolver a pendência.
const GATE_REDIRECTS: Record<string, string> = {
  MFA_ENROLLMENT_REQUIRED: "/configuracoes/seguranca",
  PASSWORD_CHANGE_REQUIRED: "/configuracoes/senha",
};

async function cookieHeader(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.toString();
}

async function currentPathname(): Promise<string> {
  return (await headers()).get("x-pathname") ?? "";
}

// Lê apenas o error.code do corpo (403 de gate). Não toca em token/cookie/segredo.
async function gateTargetFor(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { code?: string } };
    return GATE_REDIRECTS[body.error?.code ?? ""] ?? null;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1${path}`, {
      headers: { cookie: await cookieHeader() },
      cache: "no-store",
    });
  } catch {
    // API inacessível (ex.: durante um deploy) → temporário, NÃO desloga.
    throw new ApiUnavailableError();
  }

  if (response.status === 401) redirect("/login");

  if (response.status === 403) {
    // Gate de 2FA/senha pendente: leva à tela certa em vez de quebrar a página.
    // O guarda de pathname impede redirecionar para a própria tela (sem loop).
    const target = await gateTargetFor(response);
    if (target) {
      if ((await currentPathname()) !== target) redirect(target);
      throw new ApiUnavailableError(403);
    }
  }

  if (response.status >= 500) throw new ApiUnavailableError(response.status); // 5xx transitório

  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

// Memoizado por request: layout, header, sidebar e página compartilham UMA
// única chamada a /auth/me (o principal) em vez de repetir o auth guard.
export const requireSession = cache(async (): Promise<SessionPrincipal> => {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1/auth/me`, {
      headers: { cookie: await cookieHeader() },
      cache: "no-store",
    });
  } catch {
    // API fora do ar durante o deploy → temporário, NÃO desloga (não vira loop de /login).
    throw new ApiUnavailableError();
  }
  if (response.status === 401) redirect("/login"); // sessão realmente inválida/expirada
  if (!response.ok) throw new ApiUnavailableError(response.status); // 5xx/transitório: não desloga
  const body = (await response.json()) as { data: SessionPrincipal };
  return body.data;
});
