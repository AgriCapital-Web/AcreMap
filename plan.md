# AcreMap — plan consolidé d'installation, migrations et intégration CRM

## Source de vérité

- Dépôt officiel : https://github.com/AgriCapital-Web/AcreMap — branche `Principal`.
- Projet Supabase AcreMap : référence `ckkjqpsoavrikgiuuktf`.
- Projet Supabase CRM : référence `rfzfsmpsuempafhkqhra` (base distincte).
- Migration de base : `supabase/migrations/20261017030000_acremap_complete_setup.sql`.
- Durcissement RLS : `supabase/migrations/20261017040000_acremap_morcellement_rls_hardening.sql`.
- Page d'administration : `/app/parametres` → **Exécuter la migration**.
- Le bouton n'accepte aucun SQL envoyé par le navigateur : il lance une migration fixe, revue, versionnée et idempotente côté serveur. Le jeton Management API peut être configuré comme secret Vercel ou saisi temporairement dans le formulaire administrateur ; dans ce second cas il est transmis uniquement à la requête et n'est pas stocké.

## Ce que couvre la migration AcreMap

1. Registre `public.acremap_schema_migrations` pour suivre les versions exécutées.
2. Registre des propriétaires synchronisés depuis le CRM : `public.crm_landowners`, index, RLS et droits nécessaires.
3. Table de plans de morcellement `public.morcellement_plans` et colonnes utilisées par la synchronisation locale/cloud.
4. Colonnes et index de lots pour le plan, le type de lot, la partie, la superficie cible, l'assignation et le propriétaire CRM.
5. Relation optionnelle `lots.assignee_owner_id → crm_landowners.id`, créée sans valider rétroactivement d'éventuelles anciennes lignes.
6. Bucket Storage privé `imports` et politiques permettant à chaque utilisateur authentifié d'accéder uniquement aux fichiers dans son propre dossier.
7. Politiques RLS des plans : un utilisateur peut lire/modifier/supprimer ses propres plans ; les rôles globaux `admin`, `pdg` et `dg` conservent l'accès global.

La migration **ne supprime pas** les tables, les lots, les fichiers ni les données existantes. Elle s'arrête explicitement si la table de base `public.lots` est absente : le schéma métier initial doit être installé avant cette intégration. Les objets déjà présents ne sont pas recréés en double.

## Préparation du bouton Migration

Le bouton appelle l'endpoint Supabase Management API `POST /v1/projects/{ref}/database/query`, qui est documenté comme expérimental. Pour l'utiliser :

1. Dans Supabase, créer un jeton Management API avec les droits de base de données nécessaires sur le projet AcreMap.
2. Se connecter à AcreMap comme administrateur principal et ouvrir **Paramètres & intégrations**.
3. Coller le jeton temporaire dans le champ dédié, puis cliquer sur **Exécuter la migration**. Le champ est effacé après succès ; le jeton n'est pas conservé par l'application. En alternative, définir `SUPABASE_ACCESS_TOKEN` comme secret serveur dans Vercel pour ne pas avoir à le saisir à chaque exécution.
4. Vérifier le message de réussite ou l'erreur renvoyée par Supabase. Si l'API Management refuse la requête, utiliser le SQL versionné ci-dessous dans le SQL Editor du projet AcreMap, avec un compte autorisé.

**Ne jamais** placer `SUPABASE_ACCESS_TOKEN` ou `SUPABASE_SERVICE_ROLE_KEY` dans une variable `VITE_*`, dans Git, dans le navigateur ou dans un document public.

## Variables Vercel nécessaires

| Variable | Usage |
|---|---|
| `SUPABASE_URL` | URL du projet Supabase AcreMap |
| `SUPABASE_PUBLISHABLE_KEY` | Clé publique pour le client Supabase côté serveur |
| `VITE_SUPABASE_URL` | URL Supabase utilisée par le navigateur |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé publique utilisée par le navigateur |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé secrète serveur pour les opérations d'administration des comptes |
| `SUPABASE_ACCESS_TOKEN` | Jeton de gestion limité au projet, requis pour le bouton de migration |
| `SUPABASE_PROJECT_REF` | `ckkjqpsoavrikgiuuktf` |
| `ACREMAP_CRM_API_KEY` | Clé Bearer reçue par `POST /api/v1/integration` pour synchroniser les propriétaires |
| `CRM_WEBHOOK_URL` | `https://rfzfsmpsuempafhkqhra.supabase.co/functions/v1/acremap-webhook` |
| `CRM_WEBHOOK_SECRET` | Secret HMAC partagé pour signer les plans envoyés au CRM |

La page Paramètres montre seulement si chaque variable est présente, jamais sa valeur. Une variable nouvellement ajoutée à Vercel nécessite un nouveau déploiement pour être chargée par le runtime.

## Génération des clés et connexion au CRM

Dans AcreMap, ouvrir **Paramètres & intégrations** puis **Générer une clé API et un secret HMAC**. Les deux valeurs sont générées localement dans la page et ne sont pas enregistrées automatiquement : les copier immédiatement.

1. `ACREMAP_CRM_API_KEY` : ajouter la valeur comme variable secrète dans Vercel/AcreMap et la coller dans CRM → Paramètres → AcreMap API → Clé API AcreMap.
2. `CRM_WEBHOOK_SECRET` : ajouter la valeur comme variable secrète dans Vercel/AcreMap et la coller dans CRM → Paramètres → AcreMap API → Secret HMAC webhook.
3. Dans CRM, vérifier l'URL de base AcreMap `https://acremap.agricapital.ci`, enregistrer les paramètres et activer la synchronisation.
4. Lancer **Synchroniser les propriétaires** depuis le CRM.
5. Dans AcreMap, vérifier que les propriétaires apparaissent dans la liste du morcellement, publier un plan, puis vérifier dans le CRM les lots, superficies et parts AgriCapital/propriétaire.

La clé API et le secret HMAC doivent correspondre exactement dans les deux applications. Ne pas confondre ces secrets d'intégration avec la clé Supabase `service_role` ou le jeton Management API.

## Migration SQL versionnée complète

Le script ci-dessous est la copie du fichier `supabase/migrations/20261017030000_acremap_complete_setup.sql`. Le bouton exécute ensuite le durcissement RLS versionné `20261017040000_acremap_morcellement_rls_hardening.sql`, même si la migration de base a déjà été enregistrée. Les deux opérations sont idempotentes et inscrites dans le registre.

```sql
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
```

## Migration CRM séparée

La base CRM est indépendante. Sa migration `20261016250000_acremap_integration` et les Edge Functions `acremap-settings`, `acremap-sync` et `acremap-webhook` sont gérées côté CRM. Ne pas exécuter la migration AcreMap dans la base CRM, ni rejouer la migration CRM dans la base AcreMap.

## Contrôles de validation

Après migration et configuration :
- `public.crm_landowners`, `public.morcellement_plans` et `public.lots` existent.
- `public.lots.assignee_owner_id` existe et la relation vers `crm_landowners` est présente.
- Le bucket `imports` reste privé et ses politiques limitent l'accès au dossier propre à chaque utilisateur.
- La page Utilisateurs peut lire/créer des comptes uniquement lorsque `SUPABASE_SERVICE_ROLE_KEY` est configurée côté serveur.
- La synchronisation des propriétaires CRM et la publication d'un plan sont testées dans les deux sens.
- Les essais sont effectués sur mobile et ordinateur, avec contrôle du débordement horizontal, du tiroir de navigation et des formulaires.


## Durcissement RLS des plans

Le correctif `20261017040000_acremap_morcellement_rls_hardening` retire l'ancienne politique qui autorisait tout utilisateur authentifié à modifier tous les plans. Les plans sont désormais limités à leur créateur, avec accès global conservé pour les rôles `admin`, `pdg` et `dg`. Les données existantes ne sont pas supprimées. Les plans historiques sans créateur restent accessibles aux administrateurs globaux.

## Migration complémentaire — qualité et synchronisation des levés GPS

Fichier : `supabase/migrations/20261017120000_acremap_survey_quality.sql`. Migration additive, réexécutable et reliée à `public.measurements`. Elle conserve les champs GPS/QA existants et ajoute les métadonnées de création hors ligne et de synchronisation. Elle ne supprime ni ne réécrit les levés existants. À exécuter dans le projet Supabase AcreMap, jamais dans le projet CRM.

```sql
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
```

## Levés GPS en zone blanche (sans réseau mobile)

Le GNSS/GPS du téléphone peut fournir une position sans carte SIM, sans Wi‑Fi et sans données mobiles. Il faut toutefois que l'appareil voie suffisamment de satellites ; le premier fix peut être plus lent à froid, en forêt dense, près de bâtiments ou dans une vallée. La précision dépend du téléphone et de l'environnement, pas de la connexion Internet.

Dans AcreMap, l'écran de levée garde les points, le tracé, les contrôles qualité et les brouillons dans IndexedDB. Le service worker conserve l'application après un premier chargement en ligne. En zone blanche, la levée reste locale ; les écritures cloud restent dans la file et sont renvoyées lors du retour du réseau. Le statut de synchronisation n'est donc pas une confirmation serveur tant que la connexion n'est pas revenue.

Le fond cartographique est distinct du GPS : les tuiles doivent avoir été téléchargées avant de partir. La page de levée propose un préchargement de la zone autour de la position GPS. Quand le téléphone passe hors ligne, un fond schématique est activé automatiquement afin que les points et le polygone restent visibles même si aucune tuile n'est disponible. Le bouton des couches permet d'afficher les cartes mises en cache si elles existent.

Limites réelles à respecter : le navigateur doit avoir déjà installé le service worker et téléchargé les ressources de l'application ; les données de parcelles à consulter doivent avoir été synchronisées sur cet appareil ; le stockage local peut être purgé par le système ; le navigateur peut suspendre le GPS si l'écran ou l'application est mis en arrière-plan. Garder AcreMap ouvert et l'écran éveillé pendant le levé est recommandé. Aucune application Web ne peut promettre une précision GPS fixe ou une exécution continue garantie lorsque le système ferme le navigateur.

## Mode hors ligne terrain et réseau faible

- Le service worker est enregistré depuis la racine, y compris depuis la connexion, et précharge les routes principales. Les ressources et tuiles déjà consultées/téléchargées sont conservées localement.
- Le levé actif et ses indicateurs GPS sont enregistrés automatiquement dans IndexedDB et peuvent être repris après rechargement sur le même appareil et le même compte.
- Les opérations cloud passent par une file durable, des requêtes avec délai maximal, des réessais à temporisation exponentielle et des déclencheurs de reconnexion, de retour au premier plan et de changement de réseau.
- La persistance locale est demandée au navigateur mais ne peut être garantie contre une suppression système. La précision dépend du téléphone et de l'environnement; aucune application web ne peut promettre une détection GPS parfaite.
- Le fond de carte n'est disponible hors ligne que pour les tuiles téléchargées avant la coupure. Pour la meilleure continuité GPS, garder le levé ouvert.
- La synchronisation se relance automatiquement lorsque la page/PWA est active. Quand l'application est totalement fermée, la garantie dépend des capacités du navigateur et de l'accès à une session valide côté service worker.
