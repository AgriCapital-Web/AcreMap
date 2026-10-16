-- 1. No auto role grant on public signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, full_name, username, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)), new.raw_user_meta_data->>'phone') on conflict (id) do nothing;
  return new;
end; $function$;
CREATE OR REPLACE FUNCTION public.protect_profile_lifecycle_flags() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  if public.has_role(auth.uid(), 'admin') then return new; end if;
  new.disabled := old.disabled; new.must_change_password := old.must_change_password; return new;
end; $function$;
REVOKE ALL ON FUNCTION public.protect_profile_lifecycle_flags() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_profile_lifecycle_flags ON public.profiles;
CREATE TRIGGER protect_profile_lifecycle_flags BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_lifecycle_flags();
DROP POLICY IF EXISTS acremap_files_select ON storage.objects;
CREATE POLICY acremap_files_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id = ANY (ARRAY['imports','photos']) AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;