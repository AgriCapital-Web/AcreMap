import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
export const Route = createFileRoute("/api/v1/integration")({
 server: { handlers: {
  GET: async ({ request }) => {
   if (!authenticate(request)) return json({ error: "unauthorized" }, 401);
   const resource = new URL(request.url).searchParams.get("resource") ?? "health";
   if (resource === "health") return json({ ok: true, service: "AcreMap CRM API", version: "v1" });
   if (resource === "owners") { const { data, error } = await supabaseAdmin.from("crm_landowners").select("id,full_name,phone,account_code,active,source_updated_at").order("full_name"); if (error) return json({ error: "owners_unavailable" }, 503); return json({ data: data ?? [] }); }
   if (resource === "plans") {
    const { data: plans, error } = await supabaseAdmin.from("morcellement_plans").select("id,parcelle_id,measurement_id,reference,config,score,target_m2,total_m2,conforme,status,created_at,updated_at").order("updated_at", { ascending: false }).limit(500);
    if (error) return json({ error: "plans_unavailable" }, 503);
    const ids = (plans ?? []).map((item) => item.id);
    const { data: lots, error: lotError } = ids.length ? await supabaseAdmin.from("lots").select("id,plan_id,parcelle_id,measurement_id,code,polygon,area_m2,target_area_m2,part,kind,label,assignee_name,assignee_owner_id,assignee_contact,assignee_account,is_reserve").in("plan_id", ids) : { data: [], error: null };
    if (lotError) return json({ error: "lots_unavailable" }, 503);
    return json({ data: (plans ?? []).map((plan) => ({ ...plan, lots: (lots ?? []).filter((lot) => lot.plan_id === plan.id) })) });
   }
   return json({ error: "unknown_resource" }, 400);
  },
  POST: async ({ request }) => {
   if (!authenticate(request)) return json({ error: "unauthorized" }, 401);
   let body: any; try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
   if (body?.event !== "owners.sync" || !Array.isArray(body.owners) || body.owners.length > 5000) return json({ error: "invalid_payload" }, 400);
   const rows = [];
   for (const owner of body.owners) {
    if (!owner || typeof owner.id !== "string" || !owner.id.trim() || typeof owner.full_name !== "string" || !owner.full_name.trim()) return json({ error: "owner_requires_id_and_full_name" }, 400);
    rows.push({ id: owner.id.trim().slice(0,128), full_name: owner.full_name.trim().slice(0,240), phone: typeof owner.phone === "string" ? owner.phone.slice(0,60) : null, account_code: typeof owner.account_code === "string" ? owner.account_code.slice(0,120) : null, active: owner.active !== false, source_updated_at: typeof owner.updated_at === "string" ? owner.updated_at : new Date().toISOString() });
   }
   const { error } = await supabaseAdmin.from("crm_landowners").upsert(rows, { onConflict: "id" });
   if (error) return json({ error: "owners_sync_failed" }, 503);
   return json({ ok: true, received: rows.length, synced_at: new Date().toISOString() });
  }
 }}
});
function authenticate(request: Request): boolean { const expected = process.env.ACREMAP_CRM_API_KEY; const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""; if (!expected || !provided) return false; return timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(provided).digest()); }
function json(data: unknown, status = 200): Response { return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }