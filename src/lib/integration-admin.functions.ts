import { createServerFn } from "@tanstack/react-start";
import { requireNeonAuth } from "@/integrations/neon/auth-middleware";

function hasEnv(...names: string[]) {
  return names.some((name) => Boolean(process.env[name]));
}

export const getIntegrationEnvironmentStatus = createServerFn({ method: "GET" })
  .middleware([requireNeonAuth])
  .handler(async ({ context }) => {
    const { data: roleRow, error: roleError } = await context.supabase
      .from("user_roles").select("id").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (roleError || !roleRow) throw new Error("Accès réservé à l'administrateur AcreMap.");
    const checks = {
      NEON_DATABASE_URL_DEV: hasEnv("NEON_DATABASE_URL_DEV", "NEON_DATABASE_URL"),
      VITE_NEON_AUTH_URL_DEV: hasEnv("VITE_NEON_AUTH_URL_DEV", "VITE_NEON_AUTH_URL"),
      VITE_NEON_DATA_API_URL_DEV: hasEnv("VITE_NEON_DATA_API_URL_DEV", "VITE_NEON_DATA_API_URL"),
      NEON_PROJECT_ID_DEV: hasEnv("NEON_PROJECT_ID_DEV", "NEON_PROJECT_ID"),
      NEON_BRANCH_ID_DEV: hasEnv("NEON_BRANCH_ID_DEV", "NEON_BRANCH_ID"),
      AWS_ACCESS_KEY_ID_DEV: hasEnv("AWS_ACCESS_KEY_ID_DEV", "AWS_ACCESS_KEY_ID"),
      AWS_SECRET_ACCESS_KEY_DEV: hasEnv("AWS_SECRET_ACCESS_KEY_DEV", "AWS_SECRET_ACCESS_KEY"),
      AWS_ENDPOINT_URL_S3_DEV: hasEnv("AWS_ENDPOINT_URL_S3_DEV", "AWS_ENDPOINT_URL_S3"),
      AWS_REGION_DEV: hasEnv("AWS_REGION_DEV", "AWS_REGION"),
      ACREMAP_CRM_API_KEY_DEV: hasEnv("ACREMAP_CRM_API_KEY_DEV", "ACREMAP_CRM_API_KEY"),
      CRM_WEBHOOK_URL_DEV: hasEnv("CRM_WEBHOOK_URL_DEV", "CRM_WEBHOOK_URL"),
      CRM_WEBHOOK_SECRET_DEV: hasEnv("CRM_WEBHOOK_SECRET_DEV", "CRM_WEBHOOK_SECRET"),
      CRM_INTEGRATION_ENABLED_DEV: process.env.CRM_INTEGRATION_ENABLED_DEV !== undefined || process.env.CRM_INTEGRATION_ENABLED !== undefined,
    };
    return {
      checks,
      crmEnabled: (process.env.VERCEL_ENV === "production" ? process.env.CRM_INTEGRATION_ENABLED : process.env.CRM_INTEGRATION_ENABLED_DEV) === "true",
      missing: Object.entries(checks).filter(([, configured]) => !configured).map(([key]) => key),
    };
  });
