import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { sessionCookieName, verifySessionToken } from "@/lib/auth-session";
import { env, hasSupabaseConfig, isMySqlDatabase } from "@/lib/config";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request
  });

  if (isMySqlDatabase()) {
    const pathname = request.nextUrl.pathname;
    const pagePath = !pathname.startsWith("/api");
    const protectedPath =
      pagePath &&
      (pathname === "/" ||
        pathname.startsWith("/chat") ||
        pathname.startsWith("/admin") ||
        pathname.startsWith("/training"));
    const authPath = pathname.startsWith("/login");
    const session = await verifySessionToken(request.cookies.get(sessionCookieName)?.value);

    if (protectedPath && !session) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    if (authPath && session) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }

    return response;
  }

  if (!hasSupabaseConfig()) {
    return response;
  }

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request
        });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const protectedPath = pathname.startsWith("/chat") || pathname.startsWith("/admin");
  const authPath = pathname.startsWith("/login");

  if (protectedPath && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (authPath && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
