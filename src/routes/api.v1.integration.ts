import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "node:crypto";
import { getNeonSql } from "@/integrations/neon/db.server";

function env(name: string) {
  return process.env.VERCEL_ENV === "production"
    ? process.env[name]
    : process.env[`${name}_DEV`] ?? process.env[name];
}

export const Route = createFileRoute("/api/v1/integration")({
  server: { handlers: {
    GET: async ({ request }) => {
      if (!(await authenticate(request))) return json({ error: "unauthorized" }, 401);
      const sql = getNeonSql();
      const resource = new URL(request.url).searchParams.get("resource") ?? "health";
      try {
        if (resource === "health") {
          const [row] = await sql`SELECT current_database() AS database_name, now() AS checked_at`;
          return json({ ok: true, service: "AcreMap CRM API", version: "v1", database: row.database_name, checked_at: row.checked_at });
        }
        if (resource === "owners") {
          const data = await sql`SELECT id, full_name, phone, account_code, active, source_updated_at FROM public.crm_landowners ORDER BY full_name`;
          return json({ data });
        }
        if (resource === "plans") {
          const plans = await sql`SELECT id, parcelle_id, measurement_id, reference, config, score, target_m2, total_m2, conforme, status, created_at, updated_at FROM public.morcellement_plans ORDER BY updated_at DESC LIMIT 500`;
          const ids = plans.map((item: any) => item.id);
          const lots = ids.length
            ? await sql`SELECT id, plan_id, parcelle_id, measurement_id, code, polygon, area_m2, target_area_m2, part, kind, label, assignee_name, assignee_owner_id, assignee_contact, assignee_account, is_reserve FROM public.lots WHERE plan_id = ANY(${ids}::uuid[])`
            : [];
          return json({ data: plans.map((plan: any) => ({ ...plan, lots: lots.filter((lot: any) => lot.plan_id === plan.id) })) });
        }
        return json({ error: "unknown_resource" }, 400);
      } catch {
        return json({ error: resource === "owners" ? "owners_unavailable" : resource === "plans" ? "plans_unavailable" : "database_unavailable" }, 503);
      }
    },
    POST: async ({ request }) => {
      if (!(await authenticate(request))) return json({ error: "unauthorized" }, 401);
      let body: any;
      try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
      if (body?.event !== "owners.sync" || !Array.isArray(body.owners) || body.owners.length > 5000) return json({ error: "invalid_payload" }, 400);
      const rows = [];
      for (const owner of body.owners) {
        if (!owner || typeof owner.id !== "string" || !owner.id.trim() || typeof owner.full_name !== "string" || !owner.full_name.trim()) return json({ error: "owner_requires_id_and_full_name" }, 400);
        rows.push({
          id: owner.id.trim().slice(0, 128),
          full_name: owner.full_name.trim().slice(0, 240),
          phone: typeof owner.phone === "string" ? owner.phone.slice(0, 60) : null,
          account_code: typeof owner.account_code === "string" ? owner.account_code.slice(0, 120) : null,
          active: owner.active !== false,
          source_updated_at: typeof owner.updated_at === "string" ? owner.updated_at : new Date().toISOString(),
        });
      }
      try {
        const sql = getNeonSql();
        await sql`
          INSERT INTO public.crm_landowners (id, full_name, phone, account_code, active, source_updated_at)
          SELECT id, full_name, phone, account_code, active, source_updated_at
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
            id text, full_name text, phone text, account_code text, active boolean, source_updated_at timestamptz
          )
          ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            phone = EXCLUDED.phone,
            account_code = EXCLUDED.account_code,
            active = EXCLUDED.active,
            source_updated_at = EXCLUDED.source_updated_at,
            updated_at = now()
        `;
        return json({ ok: true, received: rows.length, synced_at: new Date().toISOString() });
      } catch {
        return json({ error: "owners_sync_failed" }, 503);
      }
    },
  } },
});

async function authenticate(request: Request): Promise<boolean> {
  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!provided) return false;
  const providedHash = createHash("sha256").update(provided).digest();
  try {
    const sql = getNeonSql();
    const rows = await sql`SELECT id FROM public.crm_api_keys WHERE key_hash = ${providedHash.toString("hex")} AND revoked_at IS NULL LIMIT 1`;
    return rows.length > 0;
  } catch {
    return false;
  }
}
function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
