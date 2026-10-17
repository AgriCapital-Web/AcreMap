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
      SUPABASE_PUBLISHABLE_KEY: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY),
      VITE_SUPABASE_URL: Boolean(process.env.VITE_SUPABASE_URL),
      VITE_SUPABASE_PUBLISHABLE_KEY: Boolean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      SUPABASE_ACCESS_TOKEN: Boolean(process.env.SUPABASE_ACCESS_TOKEN),
      SUPABASE_PROJECT_REF: Boolean(process.env.SUPABASE_PROJECT_REF || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
      ACREMAP_CRM_API_KEY: Boolean(process.env.ACREMAP_CRM_API_KEY),
      CRM_WEBHOOK_URL: Boolean(process.env.CRM_WEBHOOK_URL),
      CRM_WEBHOOK_SECRET: Boolean(process.env.CRM_WEBHOOK_SECRET),
    };
    return { checks, missing: Object.entries(checks).filter(([, configured]) => !configured).map(([key]) => key) };
  });
