import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionCookie } from "./lib/session";

const PUBLIC_PATHS = new Set(["/login", "/favicon.ico"]);
const PUBLIC_PREFIXES = ["/api/auth/", "/_next/"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const secret = process.env.APT_RADAR_SESSION_SECRET;
  if (!secret) {
    // fail closed if session secret is not configured
    if (pathname.startsWith("/api/")) {
      return new NextResponse(JSON.stringify({ error: "server_misconfigured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const cookieHeader = request.headers.get("cookie");
  const valid = await verifySessionCookie(cookieHeader, secret);

  if (!valid) {
    if (pathname.startsWith("/api/")) {
      return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
