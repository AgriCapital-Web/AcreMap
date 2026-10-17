do $acremap_rls_hardening$
declare
  migration_id constant text := '20261017040000_acremap_morcellement_rls_hardening';
begin
  if to_regclass('public.morcellement_plans') is null then
    raise exception 'Table public.morcellement_plans is missing; run the base AcreMap setup first.';
  end if;
  if to_regclass('public.user_roles') is null then
    raise exception 'Table public.user_roles is missing; role-scoped policies cannot be installed.';
  end if;
  create table if not exists public.acremap_schema_migrations (
    version text primary key, applied_at timestamptz not null default now(),
    applied_by text not null default 'settings_button'
  );
  drop policy if exists morcellement_plans_authenticated_all on public.morcellement_plans;
  drop policy if exists morcellement_plans_read_scoped on public.morcellement_plans;
  drop policy if exists morcellement_plans_insert_scoped on public.morcellement_plans;
  drop policy if exists morcellement_plans_update_scoped on public.morcellement_plans;
  drop policy if exists morcellement_plans_delete_scoped on public.morcellement_plans;
  create policy morcellement_plans_read_scoped on public.morcellement_plans for select to authenticated
    using (created_by = auth.uid() or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and lower(ur.role) in ('admin','pdg','dg')));
  create policy morcellement_plans_insert_scoped on public.morcellement_plans for insert to authenticated
    with check (created_by = auth.uid() or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and lower(ur.role) in ('admin','pdg','dg')));
  create policy morcellement_plans_update_scoped on public.morcellement_plans for update to authenticated
    using (created_by = auth.uid() or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and lower(ur.role) in ('admin','pdg','dg')))
    with check (created_by = auth.uid() or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and lower(ur.role) in ('admin','pdg','dg')));
  create policy morcellement_plans_delete_scoped on public.morcellement_plans for delete to authenticated
    using (created_by = auth.uid() or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and lower(ur.role) in ('admin','pdg','dg')));
  insert into public.acremap_schema_migrations(version, applied_by)
    values (migration_id, 'settings_button') on conflict (version) do nothing;
end
$acremap_rls_hardening$;
