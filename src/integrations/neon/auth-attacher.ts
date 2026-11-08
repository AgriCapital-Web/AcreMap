import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

// Attach a short-lived Neon Auth JWT to TanStack server-function requests.
export const attachNeonAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    let { data } = await supabase.auth.getSession();
    let session = data.session;
    const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
    if (session && expiresAt - Date.now() < 60_000) {
      const refreshed = await supabase.auth.refreshSession();
      session = refreshed.data.session ?? session;
    }
    const token = session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
