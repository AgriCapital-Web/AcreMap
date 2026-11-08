import { createClient, SupabaseAuthAdapter } from "@neondatabase/neon-js";

const authUrl =
  (import.meta.env.VITE_NEON_AUTH_URL_DEV as string | undefined) ??
  (import.meta.env.VITE_NEON_AUTH_URL as string | undefined);
const dataApiUrl =
  (import.meta.env.VITE_NEON_DATA_API_URL_DEV as string | undefined) ??
  (import.meta.env.VITE_NEON_DATA_API_URL as string | undefined);

if (!authUrl || !dataApiUrl) {
  throw new Error("Neon Auth/Data API configuration is missing.");
}

// Supabase-compatible adapter keeps the existing AcreMap auth calls stable
// while identity and persistence are now provided by Neon Managed Better Auth.
export const supabase = createClient({
  auth: { url: authUrl, adapter: SupabaseAuthAdapter() },
  dataApi: { url: dataApiUrl },
});

// Default Better Auth adapter exposes Managed Admin APIs and password flows.
export const neonAuth = createClient({
  auth: { url: authUrl },
  dataApi: { url: dataApiUrl },
});
