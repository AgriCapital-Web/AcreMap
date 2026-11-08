import { createHash, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireNeonAuth } from "@/integrations/neon/auth-middleware";
import { getNeonSql } from "@/integrations/neon/db.server";

function hasEnv(...names: string[]) {
  return names.some((name) => Boolean(process.env[name]));
}

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data: roleRow, error: roleError } = await context.supabase
    .from("user_roles").select("id").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
  if (roleError || !roleRow) throw new Error("Accès réservé à l'administrateur AcreMap.");
}

export const getIntegrationEnvironmentStatus = createServerFn({ method: "GET" })
  .middleware([requireNeonAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
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

export const getCrmIntegrationSettings = createServerFn({ method: "GET" })
  .middleware([requireNeonAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const sql = getNeonSql();
    const [config] = await sql`SELECT webhook_url, enabled, updated_at FROM public.crm_integration_config WHERE id = 1`;
    const [secret] = await sql`SELECT id FROM public.crm_integration_secrets WHERE id = 'webhook_hmac'`;
    const [key] = await sql`SELECT id FROM public.crm_api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`;
    return {
      apiBaseUrl: "https://acremap.agricapital.ci",
      webhookUrl: config?.webhook_url ?? "https://rfzfsmpsuempafhkqhra.supabase.co/functions/v1/acremap-webhook",
      enabled: config?.enabled === true,
      hasApiKey: Boolean(key),
      hasWebhookSecret: Boolean(secret),
      updatedAt: config?.updated_at ?? null,
    };
  });

export const generateCrmIntegrationCredentials = createServerFn({ method: "POST" })
  .middleware([requireNeonAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const sql = getNeonSql();
    const apiKey = "acremap_live_" + randomBytes(32).toString("base64url");
    const webhookSecret = "acremap_hmac_" + randomBytes(32).toString("base64url");
    const keyHash = createHash("sha256").update(apiKey).digest("hex");
    await sql`UPDATE public.crm_api_keys SET revoked_at = now() WHERE revoked_at IS NULL`;
    await sql`INSERT INTO public.crm_api_keys (key_hash, label, created_by) VALUES (${keyHash}, 'AgriCapital CRM', ${context.userId})`;
    await sql`
      INSERT INTO public.crm_integration_secrets (id, secret, updated_by, updated_at)
      VALUES ('webhook_hmac', ${webhookSecret}, ${context.userId}, now())
      ON CONFLICT (id) DO UPDATE SET secret = EXCLUDED.secret, updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
    return { apiKey, webhookSecret, apiBaseUrl: "https://acremap.agricapital.ci", webhookUrl: "https://rfzfsmpsuempafhkqhra.supabase.co/functions/v1/acremap-webhook" };
  });

export const saveCrmIntegrationSettings = createServerFn({ method: "POST" })
  .middleware([requireNeonAuth])
  .inputValidator((input: { webhookUrl: string; enabled: boolean }) => {
    const webhookUrl = input?.webhookUrl?.trim();
    if (!webhookUrl || typeof input.enabled !== "boolean") throw new Error("Configuration CRM invalide.");
    const parsed = new URL(webhookUrl);
    if (parsed.protocol !== "https:") throw new Error("Le webhook CRM doit utiliser HTTPS.");
    return { webhookUrl: parsed.toString(), enabled: input.enabled };
  })
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const sql = getNeonSql();
    const [key] = await sql`SELECT id FROM public.crm_api_keys WHERE revoked_at IS NULL LIMIT 1`;
    const [secret] = await sql`SELECT id FROM public.crm_integration_secrets WHERE id = 'webhook_hmac'`;
    if (data.enabled && (!key || !secret)) throw new Error("Générez d'abord les clés AcreMap, puis configurez-les dans le CRM.");
    await sql`
      INSERT INTO public.crm_integration_config (id, webhook_url, enabled, updated_by, updated_at)
      VALUES (1, ${data.webhookUrl}, ${data.enabled}, ${context.userId}, now())
      ON CONFLICT (id) DO UPDATE SET webhook_url = EXCLUDED.webhook_url, enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
    return { webhookUrl: data.webhookUrl, enabled: data.enabled };
  });
