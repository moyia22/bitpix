import type { SessionPrincipal } from "@bitpix/contracts";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

const apiUrl = process.env.API_URL ?? "http://localhost:3333";

async function cookieHeader(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.toString();
}

export async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    headers: { cookie: await cookieHeader() },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/login");
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

// Memoizado por request: layout, header, sidebar e página compartilham UMA
// única chamada a /auth/me (o principal) em vez de repetir o auth guard.
export const requireSession = cache(async (): Promise<SessionPrincipal> => {
  const response = await fetch(`${apiUrl}/api/v1/auth/me`, {
    headers: { cookie: await cookieHeader() },
    cache: "no-store",
  });
  if (!response.ok) redirect("/login");
  const body = await response.json() as { data: SessionPrincipal };
  return body.data;
});
