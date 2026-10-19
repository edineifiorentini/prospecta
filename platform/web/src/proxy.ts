import { NextResponse, type NextRequest } from "next/server";

// Verificação otimista: sem cookie de sessão, manda para o login.
// A autorização real acontece na API em cada requisição.
const PUBLIC = ["/login", "/setup", "/esqueci-senha", "/redefinir-senha"];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = req.cookies.has("pp_session");

  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
};
