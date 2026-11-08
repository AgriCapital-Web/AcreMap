import { createServerFn } from "@tanstack/react-start";
import { requireNeonAuth } from "@/integrations/neon/auth-middleware";

const FOUNDATION_VERSION = "20261108_neon_backend_foundation";

export const runAcreMapMigrations = createServerFn({ method: "POST" })
  .middleware([requireNeonAuth])
  .handler(async ({ context }) => {
    const { data: roleRow, error: roleError } = await context.supabase
      .from("user_roles").select("id").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (roleError || !roleRow) throw new Error("Accès réservé à l'administrateur AcreMap.");
    const { getNeonSql } = await import("@/integrations/neon/db.server");
    const sql = getNeonSql();
    const rows = await sql`SELECT version, applied_at FROM public.acremap_schema_migrations WHERE version = ${FOUNDATION_VERSION} LIMIT 1`;
    const data = rows[0] as { version: string; applied_at: string } | undefined;
    if (!data) throw new Error("Le schéma Neon AcreMap n'est pas encore installé sur cette branche.");
    return {
      ok: true,
      version: data.version,
      appliedAt: data.applied_at,
      message: "Schéma Neon AcreMap opérationnel — migration " + data.version + ".",
    };
  });
