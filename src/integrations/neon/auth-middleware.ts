import { Buffer } from "node:buffer";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@neondatabase/neon-js";

function env(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

export const requireNeonAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    const authHeader = request?.headers.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Neon session required");
    }
    const token = authHeader.slice(7).trim();
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Unauthorized: Invalid token");
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("Unauthorized: Invalid token");
    }
    const userId = typeof claims.sub === "string" ? claims.sub : "";
    const expiresAt = typeof claims.exp === "number" ? claims.exp : 0;
    if (!userId || (expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000))) {
      throw new Error("Unauthorized: Expired or invalid token");
    }
    const dataApiUrl = env("VITE_NEON_DATA_API_URL_DEV", "VITE_NEON_DATA_API_URL");
    if (!dataApiUrl) throw new Error("Neon Data API URL is not configured.");

    // The Data API validates the JWT signature and issuer; the profile lookup
    // also enforces RLS before the request is allowed to continue.
    const supabase = createClient({
      dataApi: { url: dataApiUrl, getToken: async () => token },
    });
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, disabled")
      .eq("id", userId)
      .maybeSingle();
    if (error || !profile || profile.disabled) {
      throw new Error("Unauthorized: Neon identity or AcreMap profile is unavailable");
    }
    return next({ context: { supabase, userId, claims } });
  },
);
