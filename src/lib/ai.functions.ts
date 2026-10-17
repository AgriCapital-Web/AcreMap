import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Statut des intégrations facultatives. Aucun fournisseur d'IA externe n'est utilisé. */
export const getIntegrationsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ ai: false, googleMaps: Boolean(process.env["GOOGLE_MAPS_API_KEY"]) }));

/** Clé cartographique facultative, fournie par le serveur après authentification. */
export const getGoogleMapsKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ key: process.env["GOOGLE_MAPS_API_KEY"] ?? null }));
