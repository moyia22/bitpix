import { NextResponse, type NextRequest } from "next/server";

const protectedPrefixes = [
  "/nova-venda",
  "/dashboard",
  "/historico",
  "/caixa",
  "/relatorios",
  "/configuracoes",
  "/usuarios",
  "/filiais",
  "/auditoria",
];

export function proxy(request: NextRequest) {
  const isProtected = protectedPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix));
  const hasSession = request.cookies.has(process.env.SESSION_COOKIE_NAME ?? "bitpix_session");

  if (isProtected && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (request.nextUrl.pathname === "/login" && hasSession) {
    return NextResponse.redirect(new URL("/nova-venda", request.url));
  }
  // Encaminha o caminho atual para os layouts (usado pelos portões pós-login).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
