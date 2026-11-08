import { createHmac, randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireNeonAuth } from "@/integrations/neon/auth-middleware";

type WebhookLot = {
  id: string; plan_id: string; parcelle_id: string; measurement_id: string; code: string;
  polygon: unknown[]; area_m2: number; target_area_m2: number; part: string; kind: string;
  label?: string | null; assignee_owner_id?: string | null; assignee_name?: string | null;
  assignee_contact?: string | null; assignee_account?: string | null;
};
function integrationEnv(name: string) {
  return process.env.VERCEL_ENV === "production"
    ? process.env[name]
    : process.env[`${name}_DEV`] ?? process.env[name];
}

export const publishMorcellementToCrm = createServerFn({ method: "POST" })
  .middleware([requireNeonAuth])
  .inputValidator((input: { plan: { id: string; parcelle_id: string; measurement_id: string; reference: string; status: string; updated_at: string; owner_id?: string | null }; lots: WebhookLot[] }) => {
    if (!input?.plan?.id || !input.plan.parcelle_id || !Array.isArray(input.lots) || input.lots.length > 2000) throw new Error("Payload de morcellement invalide.");
    for (const lot of input.lots) {
      if (!lot.code || !Number.isFinite(lot.area_m2) || lot.area_m2 < 0 || !Array.isArray(lot.polygon)) throw new Error("Un lot contient des données invalides.");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const endpoint = integrationEnv("CRM_WEBHOOK_URL")?.trim();
    const secret = integrationEnv("CRM_WEBHOOK_SECRET");
    const enabled = integrationEnv("CRM_INTEGRATION_ENABLED") === "true";
    if (!enabled) return { sent: false, configured: Boolean(endpoint && secret), disabled: true };
    if (!endpoint || !secret) return { sent: false, configured: false };
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error("CRM_WEBHOOK_URL n'est pas une URL valide."); }
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("Le webhook CRM doit utiliser HTTPS.");
    const assignedOwnerIds = [...new Set(data.lots.map((lot) => lot.assignee_owner_id).filter((id): id is string => Boolean(id)))];
    const ownerId = data.plan.owner_id ?? (assignedOwnerIds.length === 1 ? assignedOwnerIds[0] : null);
    const environment = process.env.VERCEL_ENV === "production" ? "production" : "development";
    const payload = JSON.stringify({ event: "morcellement.published", event_id: randomUUID(), occurred_at: new Date().toISOString(), owner_id: ownerId, plan: { ...data.plan, owner_id: ownerId }, lots: data.lots });
    const signature = createHmac("sha256", secret).update(payload).digest("hex");
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", "x-acremap-signature": "sha256=" + signature, "x-acremap-environment": environment },
      body: payload, signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Le webhook CRM a répondu avec le statut " + response.status + ".");
    return { sent: true, configured: true };
  });
