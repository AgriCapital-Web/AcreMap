-- AcreMap CRM integration and storage hardening; safe to rerun.
do $acremap_migration$
declare
  migration_id constant text := '20261017020000_acremap_complete_setup';
begin
  if to_regclass('public.lots') is null then
    raise exception 'Table public.lots is missing. Apply the base AcreMap schema before this integration migration.';
  end if;

  create table if not exists public.acremap_schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now(),
    applied_by text not null default 'migration'
  );

  if exists (select 1 from public.acremap_schema_migrations where version = migration_id) then
    return;
  end if;

  create table if not exists public.crm_landowners (
    id text primary key,
    full_name text not null,
    phone text,
    account_code text,
    active boolean not null default true,
    source_updated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists crm_landowners_active_name_idx on public.crm_landowners (active, full_name);
  alter table public.crm_landowners enable row level security;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='crm_landowners' and policyname='crm_landowners_read_authenticated') then
    execute 'create policy crm_landowners_read_authenticated on public.crm_landowners for select to authenticated using (true)';
  end if;
  grant select on public.crm_landowners to authenticated;
  grant select, insert, update, delete on public.crm_landowners to service_role;

  alter table public.lots add column if not exists assignee_owner_id text;
  create index if not exists lots_assignee_owner_idx on public.lots (assignee_owner_id);

  if not exists (select 1 from pg_constraint where conname='lots_assignee_owner_fk' and conrelid='public.lots'::regclass) then
    alter table public.lots add constraint lots_assignee_owner_fk
      foreign key (assignee_owner_id) references public.crm_landowners(id) on delete set null not valid;
  end if;

  insert into storage.buckets (id, name, public)
    values ('imports', 'imports', false)
    on conflict (id) do update set public = false;

  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='acremap_imports_select_own') then
    execute $policy$create policy acremap_imports_select_own on storage.objects for select to authenticated using (bucket_id='imports' and (storage.foldername(name))[1]=auth.uid()::text)$policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='acremap_imports_insert_own') then
    execute $policy$create policy acremap_imports_insert_own on storage.objects for insert to authenticated with check (bucket_id='imports' and (storage.foldername(name))[1]=auth.uid()::text)$policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='acremap_imports_update_own') then
    execute $policy$create policy acremap_imports_update_own on storage.objects for update to authenticated using (bucket_id='imports' and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id='imports' and (storage.foldername(name))[1]=auth.uid()::text)$policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='acremap_imports_delete_own') then
    execute $policy$create policy acremap_imports_delete_own on storage.objects for delete to authenticated using (bucket_id='imports' and (storage.foldername(name))[1]=auth.uid()::text)$policy$;
  end if;

  insert into public.acremap_schema_migrations(version) values (migration_id);
end
$acremap_migration$;
