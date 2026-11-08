import { createServerFn } from "@tanstack/react-start";
import { neonAuth } from "@/integrations/neon/client";
import { requireNeonAuth } from "@/integrations/neon/auth-middleware";

const clearPasswordChangeFlag = createServerFn({ method: "POST" })
  .middleware([requireNeonAuth])
  .handler(async ({ context }) => {
    const { getNeonSql } = await import("@/integrations/neon/db.server");
    const sql = getNeonSql();
    await sql`UPDATE public.profiles SET must_change_password = false WHERE id = ${context.userId}::uuid`;
    return { ok: true };
  });

export async function changeOwnPassword(input: { currentPassword: string; password: string }) {
  if (!input.currentPassword || input.password.length < 8 || input.password.length > 200) {
    throw new Error("Le mot de passe actuel et un nouveau mot de passe de 8 caractères minimum sont requis.");
  }
  const result = await neonAuth.auth.changePassword({
    currentPassword: input.currentPassword,
    newPassword: input.password,
    revokeOtherSessions: true,
  });
  if (result?.error) throw new Error(result.error.message ?? "Impossible de mettre à jour le mot de passe.");
  await clearPasswordChangeFlag();
  return { ok: true };
}
