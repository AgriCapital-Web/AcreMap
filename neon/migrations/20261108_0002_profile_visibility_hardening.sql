-- AcreMap — restrict profile visibility to the current user and administrators.
-- Removes the permissive legacy policy inherited from the former Supabase schema.
BEGIN;
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
INSERT INTO public.acremap_schema_migrations(version, applied_by)
VALUES ('20261108_0002_profile_visibility_hardening', 'github_migration')
ON CONFLICT (version) DO NOTHING;
COMMIT;
