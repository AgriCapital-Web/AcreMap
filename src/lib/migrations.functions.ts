import { createServerFn } from "@tanstack/react-start";
import { requireNeonAuth } from "@/integrations/neon/auth-middleware";

const FOUNDATION_VERSION = "20261108_neon_backend_foundation";

export const runAcreMapMigrations = createServerFn({ method: "POST" })
  .middleware([requireNeonAuth])
  .handler(async ({ context }) => {
    const { data: roleRow, error: roleError } = await context.supabase
      .from("user_roles").select("id").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (roleError || !roleRow) throw new Error("Accès réservé à l'administrateur AcreMap.");
    const { data, error } = await context.supabase
      .from("acremap_schema_migrations").select("version, applied_at").eq("version", FOUNDATION_VERSION).maybeSingle();
    if (error || !data) throw new Error("Le schéma Neon AcreMap n'est pas encore installé sur cette branche.");
    return {
      ok: true,
      version: data.version,
      appliedAt: data.applied_at,
      message: "Schéma Neon AcreMap opérationnel — migration " + data.version + ".",
    };
  });
