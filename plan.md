# Plan d'installation SQL — AcreMap

Ce document regroupe le SQL nécessaire à l'intégration AcreMap ↔ CRM. Le morcellement géométrique lui-même s'exécute dans l'application AcreMap (Turf.js) : aucune IA externe, aucun crédit IA ni moteur de calcul distant n'est requis.

## 1. Avant exécution

1. Ouvrir le projet Supabase réellement utilisé par AcreMap.
2. Vérifier que les tables applicatives `public.lots` et les mécanismes d'authentification Supabase existent.
3. Copier le script de la section 2 dans le SQL Editor, puis exécuter une seule fois. Le script est idempotent.
4. Ne pas exécuter ce script dans la base CRM : le CRM a sa propre migration `20261016250000_acremap_integration`.
5. Après exécution, déployer le code AcreMap et renseigner les variables serveur décrites dans `.env.example`.

## 2. SQL complet pour la base AcreMap

```sql
-- Registre local des propriétaires reçus du CRM.
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

drop policy if exists crm_landowners_read_authenticated on public.crm_landowners;
create policy crm_landowners_read_authenticated
  on public.crm_landowners
  for select to authenticated
  using (true);

grant select on public.crm_landowners to authenticated;
grant select, insert, update, delete on public.crm_landowners to service_role;

-- Relie chaque lot à son identifiant stable de propriétaire dans le CRM.
alter table public.lots
  add column if not exists assignee_owner_id text;

create index if not exists lots_assignee_owner_idx
  on public.lots (assignee_owner_id);
```

## 3. Contrôles après exécution

```sql
select to_regclass('public.crm_landowners') as owners_table,
       to_regclass('public.lots') as lots_table;

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'lots'
  and column_name = 'assignee_owner_id';

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'crm_landowners';
```

Résultat attendu : les deux tables existent, la colonne `assignee_owner_id` est de type `text`, et la table `crm_landowners` dispose d'une policy SELECT pour les utilisateurs authentifiés. Les écritures de synchronisation sont réservées au rôle serveur.

## 4. Variables serveur AcreMap

Configurer uniquement dans les variables d'environnement du serveur / de Vercel, jamais dans une variable `VITE_*` :

- `ACREMAP_CRM_API_KEY` : clé Bearer utilisée par le CRM pour synchroniser les propriétaires.
- `CRM_WEBHOOK_URL` : URL `https://<projet-supabase-crm>.supabase.co/functions/v1/acremap-webhook`.
- `CRM_WEBHOOK_SECRET` : secret HMAC partagé avec le CRM.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `SUPABASE_SERVICE_ROLE_KEY` : identifiants du projet Supabase AcreMap. La clé service role reste strictement côté serveur.

Les secrets doivent être identiques des deux côtés. Ne jamais inscrire leurs valeurs dans Git ou dans ce document.

## 5. Flux fonctionnel

1. Le CRM envoie les propriétaires à `POST /api/v1/integration` avec `Authorization: Bearer <ACREMAP_CRM_API_KEY>`.
2. AcreMap conserve les identifiants CRM stables dans `crm_landowners`.
3. Le module local crée les lots à partir du polygone GPS, des superficies cibles et des règles de partage.
4. À la publication, AcreMap signe l'événement `morcellement.published` avec HMAC et le transmet au webhook CRM.
5. Le CRM conserve le plan et les lots, puis met à jour les superficies et parts du propriétaire.

La base CRM doit avoir sa migration propre appliquée et les Edge Functions `acremap-settings`, `acremap-sync` et `acremap-webhook` déployées avant le test de bout en bout.


## 6. Paramètres AcreMap et génération des secrets

Une page réservée à l’administrateur est disponible à `/app/parametres` (menu latéral → Paramètres & intégrations). Elle affiche uniquement l’état présent/absent des variables serveur et génère localement une clé API et un secret HMAC à copier immédiatement. Les valeurs générées ne sont pas conservées dans la base ni dans le navigateur après rechargement.

- `ACREMAP_CRM_API_KEY` : même valeur dans Vercel/AcreMap et dans CRM → Paramètres → AcreMap API → Clé API AcreMap.
- `CRM_WEBHOOK_SECRET` : même valeur dans Vercel/AcreMap et dans CRM → Paramètres → AcreMap API → Secret HMAC webhook.
- `CRM_WEBHOOK_URL` : `https://rfzfsmpsuempafhkqhra.supabase.co/functions/v1/acremap-webhook`.
- `SUPABASE_SERVICE_ROLE_KEY` : clé secrète du projet Supabase AcreMap, à configurer uniquement côté serveur Vercel. Ne jamais la publier ni la préfixer par `VITE_`.

La migration AcreMap complète est versionnée dans `supabase/migrations/20261017020000_acremap_complete_setup.sql`. Elle est conçue pour être relancée sans dupliquer les objets. La migration CRM reste séparée et ne doit pas être rejouée si elle est déjà appliquée.


## 7. Bouton « Exécuter la migration » dans Paramètres

La page `/app/parametres` comporte un bouton protégé par le rôle administrateur principal. Il exécute uniquement la migration versionnée intégrée au serveur, jamais du SQL libre fourni par le navigateur.

Avant de cliquer :
1. Créer un jeton Supabase à portée limitée au seul projet AcreMap, avec le droit d'écriture Database nécessaire.
2. Dans Vercel → projet `acremap` → Settings → Environment Variables, définir `SUPABASE_ACCESS_TOKEN` avec ce jeton et `SUPABASE_PROJECT_REF=ckkjqpsoavrikgiuuktf`.
3. Appliquer ces variables à Production et redéployer l'application.
4. Ouvrir AcreMap avec le compte administrateur principal, aller dans Paramètres & intégrations et cliquer sur « Exécuter la migration ».

Le bouton utilise l'endpoint Management API Supabase `POST /v1/projects/{ref}/database/query`. Cet endpoint est documenté comme expérimental ; si Supabase le refuse, le message d'erreur est affiché et le script versionné reste disponible pour une exécution via une voie d'administration autorisée. La clé `SUPABASE_ACCESS_TOKEN` est strictement côté serveur et ne doit jamais être préfixée par `VITE_`.

La migration prépare :
- la table `public.crm_landowners`, son index et sa politique de lecture authentifiée ;
- la colonne `public.lots.assignee_owner_id`, son index et sa relation optionnelle vers le propriétaire CRM ;
- le registre des migrations `public.acremap_schema_migrations` pour éviter les répétitions ;
- le bucket privé `imports` et des politiques Storage limitant les fichiers au dossier correspondant à l'identifiant de l'utilisateur connecté.

Cette migration ne crée pas les tables métier de base qui doivent déjà exister dans AcreMap (notamment `public.lots`) et ne modifie pas la base CRM. Elle s'arrête explicitement si le schéma AcreMap de base est absent. Les données et les buckets existants ne sont pas supprimés.
