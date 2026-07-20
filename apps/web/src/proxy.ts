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
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
