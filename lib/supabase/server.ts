import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env, hasSupabaseAdminConfig, hasSupabaseConfig } from "@/lib/config";

export function createSupabaseBrowserLikeClient() {
  if (!hasSupabaseConfig()) {
    return null;
  }

  return createClient(env.supabaseUrl, env.supabaseAnonKey);
}

export async function createSupabaseServerClient() {
  if (!hasSupabaseConfig()) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies. Middleware and route handlers refresh sessions.
        }
      }
    }
  });
}

export function createSupabaseAdminClient() {
  if (!hasSupabaseAdminConfig()) {
    return null;
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
