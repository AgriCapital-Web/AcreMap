-- AcreMap: additive survey sync metadata; keeps existing measurement and QA rows intact.
begin;
do $migration$
begin
 if to_regclass('public.measurements') is null then raise exception 'Table public.measurements is missing. Apply the base AcreMap schema first.'; end if;
end
$migration$;
alter table public.measurements
 add column if not exists offline_created boolean not null default false,
 add column if not exists sync_state text not null default 'synced',
 add column if not exists synced_at timestamptz,
 add column if not exists measured_at timestamptz;
do $constraint$
begin
 if not exists(select 1 from pg_constraint where conname='measurements_sync_state_check' and conrelid='public.measurements'::regclass) then
  alter table public.measurements add constraint measurements_sync_state_check check(sync_state in ('pending','synced','error')) not valid;
 end if;
end
$constraint$;
create index if not exists measurements_sync_state_idx on public.measurements(sync_state,created_at desc);
create index if not exists measurements_measured_at_idx on public.measurements(measured_at desc);
commit;
