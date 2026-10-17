import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getIntegrationEnvironmentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roleRow, error: roleError } = await context.supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError || !roleRow) throw new Error("Accès réservé à l'administrateur AcreMap.");

    const checks = {
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      ACREMAP_CRM_API_KEY: Boolean(process.env.ACREMAP_CRM_API_KEY),
      CRM_WEBHOOK_URL: Boolean(process.env.CRM_WEBHOOK_URL),
      CRM_WEBHOOK_SECRET: Boolean(process.env.CRM_WEBHOOK_SECRET),
    };
    return { checks, missing: Object.entries(checks).filter(([, configured]) => !configured).map(([key]) => key) };
  });
