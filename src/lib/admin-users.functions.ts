import { neonAuth, supabase } from "@/integrations/neon/client";
import type { Role } from "@/lib/types";

type Input<T> = { data: T };
type UserRow = {
  id: string; fullName: string; username: string; email: string | null;
  roles: string[]; mustChangePassword: boolean; disabled: boolean; createdAt: string;
};

async function assertAdmin() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) throw new Error("Session administrateur requise.");
  const [{ data: roles, error: roleError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.from("profiles").select("disabled").eq("id", user.id).maybeSingle(),
  ]);
  if (roleError || profileError || profile?.disabled || !roles?.some((r: any) => r.role === "admin")) {
    throw new Error("Accès réservé à l'administrateur AcreMap.");
  }
  return user.id;
}

function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function unwrap<T>(result: any, label: string): T {
  if (result?.error) throw new Error(result.error.message ?? label);
  return result?.data as T;
}

export async function listUsersAdmin(): Promise<UserRow[]> {
  await assertAdmin();
  const authResult = await neonAuth.auth.admin.listUsers({ query: { limit: 200 } });
  const authData = unwrap<any>(authResult, "Impossible de lister les comptes Neon.");
  const users = authData?.users ?? [];
  const [{ data: profiles, error: profileError }, { data: roles, error: roleError }] = await Promise.all([
    supabase.from("profiles").select("id,full_name,username,must_change_password,disabled,created_at"),
    supabase.from("user_roles").select("user_id,role"),
  ]);
  if (profileError || roleError) throw new Error("Impossible de charger les profils et rôles AcreMap.");
  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  const roleMap = new Map<string, string[]>();
  for (const row of roles ?? []) roleMap.set(row.user_id, [...(roleMap.get(row.user_id) ?? []), row.role]);
  return users.map((u: any) => {
    const p: any = profileMap.get(u.id) ?? {};
    return {
      id: u.id,
      fullName: p.full_name || u.name || "",
      username: p.username || "",
      email: u.email ?? null,
      roles: roleMap.get(u.id) ?? [],
      mustChangePassword: Boolean(p.must_change_password),
      disabled: Boolean(p.disabled || u.banned),
      createdAt: p.created_at ?? u.createdAt ?? new Date().toISOString(),
    };
  });
}

export async function createUserAdmin({ data }: Input<{ fullName: string; username: string; email: string; role: Role }>) {
  await assertAdmin();
  const fullName = data.fullName.trim();
  const username = data.username.trim().toLowerCase();
  const email = data.email.trim().toLowerCase();
  if (fullName.length < 2 || username.length < 2 || !email.includes("@")) throw new Error("Informations du compte invalides.");
  const tempPassword = temporaryPassword();
  const created = await neonAuth.auth.admin.createUser({
    email, password: tempPassword, name: fullName,
    role: data.role === "admin" ? "admin" : "user",
    data: { full_name: fullName, username },
  });
  const createdData = unwrap<any>(created, "Impossible de créer le compte Neon.");
  const user = createdData?.user ?? createdData;
  if (!user?.id) throw new Error("Neon n'a pas retourné l'identifiant du nouveau compte.");
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: user.id, full_name: fullName, username, must_change_password: true, disabled: false,
  });
  if (profileError) {
    await neonAuth.auth.admin.removeUser({ userId: user.id }).catch(() => undefined);
    throw new Error("Impossible de créer le profil AcreMap.");
  }
  const { error: roleError } = await supabase.from("user_roles").insert({ user_id: user.id, role: data.role });
  if (roleError) {
    await neonAuth.auth.admin.removeUser({ userId: user.id }).catch(() => undefined);
    throw new Error("Impossible d'attribuer le rôle AcreMap.");
  }
  return { email, tempPassword };
}

export async function setUserRoleAdmin({ data }: Input<{ userId: string; role: Role }>) {
  const actorId = await assertAdmin();
  if (actorId === data.userId) throw new Error("Vous ne pouvez pas modifier votre propre rôle.");
  const role = data.role;
  const authRole = role === "admin" ? "admin" : "user";
  const authUpdate = await neonAuth.auth.admin.setRole({ userId: data.userId, role: authRole });
  unwrap(authUpdate, "Impossible de mettre à jour le rôle Neon.");
  const { error: deleteError } = await supabase.from("user_roles").delete().eq("user_id", data.userId);
  if (deleteError) throw new Error("Impossible de retirer l'ancien rôle AcreMap.");
  const { error } = await supabase.from("user_roles").insert({ user_id: data.userId, role });
  if (error) throw new Error("Impossible d'enregistrer le rôle AcreMap.");
}

export async function toggleUserDisabledAdmin({ data }: Input<{ userId: string; disabled: boolean }>) {
  const actorId = await assertAdmin();
  if (actorId === data.userId) throw new Error("Vous ne pouvez pas archiver votre propre compte.");
  const result = data.disabled
    ? await neonAuth.auth.admin.banUser({ userId: data.userId, banReason: "Compte AcreMap archivé" })
    : await neonAuth.auth.admin.unbanUser({ userId: data.userId });
  unwrap(result, "Impossible de modifier l'état du compte Neon.");
  const { error } = await supabase.from("profiles").update({ disabled: data.disabled }).eq("id", data.userId);
  if (error) throw new Error("Impossible de mettre à jour le profil AcreMap.");
}

export async function resetUserPasswordAdmin({ data }: Input<{ userId: string }>) {
  await assertAdmin();
  const tempPassword = temporaryPassword();
  const result = await neonAuth.auth.admin.setUserPassword({ userId: data.userId, newPassword: tempPassword });
  unwrap(result, "Impossible de réinitialiser le mot de passe Neon.");
  const usersResult = await neonAuth.auth.admin.listUsers({ query: { limit: 200 } });
  const usersData = unwrap<any>(usersResult, "Impossible de relire les comptes Neon.");
  const user = (usersData?.users ?? []).find((item: any) => item.id === data.userId);
  const { error } = await supabase.from("profiles").update({ must_change_password: true }).eq("id", data.userId);
  if (error) throw new Error("Mot de passe réinitialisé, mais le profil n'a pas été mis à jour.");
  return { email: user?.email ?? "", tempPassword };
}

export async function updateUserAdmin({ data }: Input<{ userId: string; fullName: string; username: string }>) {
  await assertAdmin();
  const fullName = data.fullName.trim();
  const username = data.username.trim().toLowerCase();
  if (fullName.length < 2 || username.length < 2) throw new Error("Nom ou identifiant invalide.");
  const authUpdate = await neonAuth.auth.admin.updateUser({ userId: data.userId, data: { name: fullName } });
  unwrap(authUpdate, "Impossible de modifier le compte Neon.");
  const { error } = await supabase.from("profiles").update({ full_name: fullName, username }).eq("id", data.userId);
  if (error) throw new Error("Impossible de modifier le profil AcreMap.");
}
