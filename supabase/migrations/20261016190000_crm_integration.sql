-- Stable CRM owner IDs synced into AcreMap and linked to lots.
create table if not exists public.crm_landowners (id text primary key, full_name text not null, phone text, account_code text, active boolean not null default true, source_updated_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists crm_landowners_active_name_idx on public.crm_landowners (active, full_name);
alter table public.crm_landowners enable row level security;
drop policy if exists crm_landowners_read_authenticated on public.crm_landowners;
create policy crm_landowners_read_authenticated on public.crm_landowners for select to authenticated using (true);
grant select on public.crm_landowners to authenticated;
grant select, insert, update, delete on public.crm_landowners to service_role;
alter table public.lots add column if not exists assignee_owner_id text;
create index if not exists lots_assignee_owner_idx on public.lots (assignee_owner_id);