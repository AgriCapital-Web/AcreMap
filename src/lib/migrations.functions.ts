import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MIGRATION_ID = "20261017030000_acremap_complete_setup";
const HARDENING_MIGRATION_ID = "20261017040000_acremap_morcellement_rls_hardening";

/**
 * Idempotent, versioned setup for the AcreMap database.
 * Runs only a fixed, reviewed SQL payload against the configured AcreMap project.
 * The Management API token is server-only and must be scoped to this one project.
 */
const MIGRATION_SQL = String.raw`
do $acremap_migration$
declare
  migration_id constant text := '20261017030000_acremap_complete_setup';
begin
  if to_regclass('public.lots') is null then
    raise exception 'Table public.lots is missing. Apply the base AcreMap schema before this integration migration.';
  end if;

  create table if not exists public.acremap_schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now(),
    applied_by text not null default 'settings_button'
  );

  if exists (select 1 from public.acremap_schema_migrations where version = migration_id) then
    raise notice 'Migration % already applied', migration_id;
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
  create index if not exists crm_landowners_active_name_idx
    on public.crm_landowners (active, full_name);
  alter table public.crm_landowners enable row level security;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'crm_landowners'
      and policyname = 'crm_landowners_read_authenticated'
  ) then
    execute 'create policy crm_landowners_read_authenticated on public.crm_landowners for select to authenticated using (true)';
  end if;
  grant select on public.crm_landowners to authenticated;
  grant select, insert, update, delete on public.crm_landowners to service_role;

  -- Ensure the plan table used by the online/offline sync exists.
  create table if not exists public.morcellement_plans (
    id text primary key,
    parcelle_id text not null,
    measurement_id text,
    reference text,
    config jsonb,
    score jsonb,
    target_m2 numeric,
    total_m2 numeric,
    conforme boolean not null default false,
    status text not null default 'draft',
    notes text,
    created_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  alter table public.morcellement_plans add column if not exists parcelle_id text;
  alter table public.morcellement_plans add column if not exists measurement_id text;
  alter table public.morcellement_plans add column if not exists reference text;
  alter table public.morcellement_plans add column if not exists config jsonb;
  alter table public.morcellement_plans add column if not exists score jsonb;
  alter table public.morcellement_plans add column if not exists target_m2 numeric;
  alter table public.morcellement_plans add column if not exists total_m2 numeric;
  alter table public.morcellement_plans add column if not exists conforme boolean not null default false;
  alter table public.morcellement_plans add column if not exists status text not null default 'draft';
  alter table public.morcellement_plans add column if not exists notes text;
  alter table public.morcellement_plans add column if not exists created_by uuid;
  alter table public.morcellement_plans add column if not exists created_at timestamptz not null default now();
  alter table public.morcellement_plans add column if not exists updated_at timestamptz not null default now();
  alter table public.morcellement_plans enable row level security;
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
  grant select, insert, update, delete on public.morcellement_plans to authenticated;
  grant select, insert, update, delete on public.morcellement_plans to service_role;

  alter table public.lots add column if not exists plan_id text;
  alter table public.lots add column if not exists part text default 'proprietaire';
  alter table public.lots add column if not exists kind text default 'lot';
  alter table public.lots add column if not exists label text;
  alter table public.lots add column if not exists target_area_m2 numeric;
  alter table public.lots add column if not exists assignee_owner_id text;
  alter table public.lots add column if not exists assignee_contact text;
  alter table public.lots add column if not exists assignee_account text;
  alter table public.lots add column if not exists assigned_at timestamptz;
  alter table public.lots add column if not exists is_reserve boolean not null default false;
  create index if not exists lots_assignee_owner_idx on public.lots (assignee_owner_id);
  create index if not exists lots_plan_id_idx on public.lots (plan_id);

  if not exists (
    select 1 from pg_constraint
    where conname = 'lots_assignee_owner_fk'
      and conrelid = 'public.lots'::regclass
  ) then
    alter table public.lots
      add constraint lots_assignee_owner_fk
      foreign key (assignee_owner_id) references public.crm_landowners(id)
      on delete set null not valid;
  end if;

  insert into storage.buckets (id, name, public)
    values ('imports', 'imports', false)
    on conflict (id) do update set public = false;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'acremap_imports_select_own'
  ) then
    execute $policy$create policy acremap_imports_select_own on storage.objects for select to authenticated using (bucket_id = 'imports' and (storage.foldername(name))[1] = auth.uid()::text)$policy$;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'acremap_imports_insert_own'
  ) then
    execute $policy$create policy acremap_imports_insert_own on storage.objects for insert to authenticated with check (bucket_id = 'imports' and (storage.foldername(name))[1] = auth.uid()::text)$policy$;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'acremap_imports_update_own'
  ) then
    execute $policy$create policy acremap_imports_update_own on storage.objects for update to authenticated using (bucket_id = 'imports' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'imports' and (storage.foldername(name))[1] = auth.uid()::text)$policy$;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'acremap_imports_delete_own'
  ) then
    execute $policy$create policy acremap_imports_delete_own on storage.objects for delete to authenticated using (bucket_id = 'imports' and (storage.foldername(name))[1] = auth.uid()::text)$policy$;
  end if;

  insert into public.acremap_schema_migrations(version) values (migration_id);
end
$acremap_migration$;
`;

const HARDENING_MIGRATION_SQL = String.raw`
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
`;


export const runAcreMapMigrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accessToken?: string }) => {
    if (input.accessToken !== undefined && (typeof input.accessToken !== "string" || input.accessToken.length > 500)) {
      throw new Error("Jeton Supabase invalide.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: roleRow, error: roleError } = await context.supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError || !roleRow) throw new Error("Migration réservée à l'administrateur principal.");

    const token = data.accessToken?.trim() || process.env.SUPABASE_ACCESS_TOKEN?.trim();
    const configuredUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
    let inferredRef = "";
    try { inferredRef = new URL(configuredUrl).hostname.split(".")[0] ?? ""; } catch { /* report invalid ref below */ }
    const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || inferredRef;
    if (!token) throw new Error("Jeton Supabase Management API requis. Collez un jeton autorisé à modifier la base AcreMap dans le champ sécurisé de cette page, ou configurez SUPABASE_ACCESS_TOKEN côté serveur Vercel.");
    if (!/^[a-z0-9]{15,30}$/.test(projectRef)) throw new Error("SUPABASE_PROJECT_REF invalide.");

    const migrations = [
      { id: MIGRATION_ID, sql: MIGRATION_SQL },
      { id: HARDENING_MIGRATION_ID, sql: HARDENING_MIGRATION_SQL },
    ] as const;
    for (const migration of migrations) {
      const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: migration.sql }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 1200);
        if (response.status === 401 || response.status === 403) throw new Error("Supabase a refusé le jeton de migration. Vérifiez son périmètre projet et les droits Database en écriture.");
        throw new Error(`Migration ${migration.id} refusée par Supabase (HTTP ${response.status}). ${detail}`);
      }
    }

    return {
      success: true,
      migrations: [MIGRATION_ID, HARDENING_MIGRATION_ID],
      message: "Migrations exécutées : schéma AcreMap, bucket privé imports et politiques RLS limitées au créateur du plan et aux administrateurs globaux.",
    };
  });
