// Admin-only server functions for user lifecycle management.
// All operations enforce admin role server-side via has_role().
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// has_role() now lives in the non-API-exposed `private` schema, so it can no
// longer be called via rpc(). Verify the admin role through the user_roles
// table directly: RLS lets a user read their own role row and profile.
async function assertAdmin(supabase: any, userId: string) {
  const [{ data: roleRow }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("id").eq("user_id", userId).eq("role", "admin").maybeSingle(),
    supabase.from("profiles").select("disabled").eq("id", userId).maybeSingle(),
  ]);
  if (!roleRow || !profile || profile.disabled) throw new Error("Réservé à l'administrateur");
}

function randomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint32Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}

export const listUsersAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [profilesResult, rolesResult, listed] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, username, must_change_password, disabled, created_at"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.auth.admin.listUsers({ perPage: 200 }),
    ]);
    if (profilesResult.error) throw new Error(profilesResult.error.message);
    if (rolesResult.error) throw new Error(rolesResult.error.message);
    if (listed.error) throw new Error(listed.error.message);
    const profiles = profilesResult.data ?? [];
    const roles = rolesResult.data ?? [];
    const emailById = new Map((listed.data?.users ?? []).map((u) => [u.id, u.email]));
    const rolesById = new Map<string, string[]>();
    roles.forEach((r) => {
      const arr = rolesById.get(r.user_id) ?? [];
      arr.push(r.role as string);
      rolesById.set(r.user_id, arr);
    });
    return profiles.map((p) => ({
      id: p.id,
      fullName: p.full_name,
      username: p.username,
      email: emailById.get(p.id) ?? null,
      roles: rolesById.get(p.id) ?? [],
      mustChangePassword: p.must_change_password,
      disabled: p.disabled,
      createdAt: p.created_at,
    }));
  });

export const createUserAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    fullName: z.string().min(2),
    username: z.string().min(2),
    email: z.string().email(),
    role: z.enum(["admin", "agent", "viewer"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tempPassword = randomPassword();
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, username: data.username },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Création échouée");
    // Override profile (trigger creates a default one) with the chosen values and force change-password.
    const profileWrite = await supabaseAdmin.from("profiles").upsert({
      id: created.user.id, full_name: data.fullName, username: data.username,
      must_change_password: true, disabled: false,
    });
    if (profileWrite.error) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(profileWrite.error.message);
    }
    const roleClear = await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
    if (roleClear.error) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(roleClear.error.message);
    }
    const roleWrite = await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: data.role });
    if (roleWrite.error) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(roleWrite.error.message);
    }
    return { id: created.user.id, email: data.email, tempPassword };
  });

export const setUserRoleAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), role: z.enum(["admin", "agent", "viewer"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: previousRoles, error: readError } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", data.userId);
    if (readError) throw new Error(readError.message);
    const { error: deleteError } = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    if (deleteError) throw new Error(deleteError.message);
    const { error: insertError } = await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: data.role });
    if (insertError) {
      if (previousRoles?.length) {
        await supabaseAdmin.from("user_roles").insert(previousRoles.map((row: { role: string }) => ({ user_id: data.userId, role: row.role })));
      }
      throw new Error(insertError.message);
    }
    return { ok: true };
  });

export const toggleUserDisabledAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), disabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: previous, error: readError } = await supabaseAdmin.from("profiles").select("disabled").eq("id", data.userId).maybeSingle();
    if (readError || !previous) throw new Error(readError?.message ?? "Profil introuvable.");
    const { error: profileError } = await supabaseAdmin.from("profiles").update({ disabled: data.disabled }).eq("id", data.userId);
    if (profileError) throw new Error(profileError.message);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.disabled ? "876000h" : "none",
    });
    if (error) {
      await supabaseAdmin.from("profiles").update({ disabled: previous.disabled }).eq("id", data.userId);
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const resetUserPasswordAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: previous, error: readError } = await supabaseAdmin.from("profiles").select("must_change_password").eq("id", data.userId).maybeSingle();
    if (readError || !previous) throw new Error(readError?.message ?? "Profil introuvable.");
    const { error: profileError } = await supabaseAdmin.from("profiles").update({ must_change_password: true }).eq("id", data.userId);
    if (profileError) throw new Error(profileError.message);
    const tempPassword = randomPassword();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: tempPassword });
    if (error) {
      await supabaseAdmin.from("profiles").update({ must_change_password: previous.must_change_password }).eq("id", data.userId);
      throw new Error(error.message);
    }
    return { tempPassword };
  });

// SÉCURITÉ : l'ancien endpoint « bootstrapFirstAdmin » a été supprimé.
// Il permettait à n'importe quel compte connecté de s'attribuer le rôle admin
// dès qu'aucun admin n'existait. La promotion du premier administrateur doit
// se faire manuellement en base (SQL Editor) ou via setUserRoleAdmin par un admin.


// Mise à jour du profil (nom complet / identifiant) par un administrateur.
export const updateUserAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    userId: z.string().uuid(),
    fullName: z.string().min(2),
    username: z.string().min(2),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: previous, error: readError } = await supabaseAdmin.from("profiles")
      .select("full_name, username").eq("id", data.userId).maybeSingle();
    if (readError || !previous) throw new Error(readError?.message ?? "Profil introuvable.");
    const { error } = await supabaseAdmin.from("profiles")
      .update({ full_name: data.fullName, username: data.username }).eq("id", data.userId);
    if (error) throw new Error(error.message);
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      user_metadata: { full_name: data.fullName, username: data.username },
    });
    if (authError) {
      await supabaseAdmin.from("profiles").update({ full_name: previous.full_name, username: previous.username }).eq("id", data.userId);
      throw new Error(authError.message);
    }
    return { ok: true };
  });
