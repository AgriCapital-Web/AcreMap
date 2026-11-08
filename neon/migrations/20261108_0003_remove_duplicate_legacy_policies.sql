-- AcreMap — remove duplicate legacy policies left by the Supabase-era schema.
-- The canonical own/admin policies are defined in 20261108_0001_initial.sql.
BEGIN;
DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
DROP POLICY IF EXISTS user_roles_admin_manage ON public.user_roles;
DROP POLICY IF EXISTS user_roles_select_self_or_admin ON public.user_roles;
INSERT INTO public.acremap_schema_migrations(version, applied_by)
VALUES ('20261108_0003_remove_duplicate_legacy_policies', 'github_migration')
ON CONFLICT (version) DO NOTHING;
COMMIT;
