# AcreMap

Application AgriCapital de gestion cartographique, levés GPS, parcelles, morcellements et exports SIG.

## Développement

- Node.js 24.x
- Installer : `npm install`
- Développement : `npm run dev`
- Vérification TypeScript : `npm run check`
- Compilation : `npm run build`
- Lint : `npm run lint`

## Architecture backend

- **Neon PostgreSQL** : base métier, relations, migrations versionnées et Row-Level Security.
- **Neon Managed Better Auth** : authentification, sessions et administration des comptes.
- **Neon Data API** : accès PostgREST compatible pour les lectures/écritures applicatives avec JWT et RLS.
- **Neon Object Storage** : fichiers privés dans les buckets `imports` et `photos`; transferts via URL présignée, sans exposer les clés S3 au navigateur.
- **Vercel** : déploiement TanStack Start, variables d'environnement distinctes pour développement, prévisualisation et production.
- **GitHub** : dépôt officiel `AgriCapital-Web/AcreMap`, branche stable `Principal`.

Les variables de développement utilisent le suffixe `_DEV`. Les variables de production restent séparées jusqu'à la validation complète du basculement.

## Données hors ligne et moteur de morcellement

IndexedDB/Dexie sert de stockage local et de cache. La file d'attente synchronise les changements pris en charge avec Neon à la reconnexion. Les lectures cloud sont paginées pour éviter de tronquer les tables volumineuses.

Le moteur géométrique s'exécute dans l'application à partir des relevés GPS, avec Turf.js embarqué. Il valide le périmètre, calcule les surfaces, construit les lots et voies, conserve les reliquats et contrôle le bilan surfacique. Aucun modèle IA ou service distant ne calcule les lots. Les exports PDF, CSV, DXF, GeoJSON, KML et Shapefile sont générés côté navigateur.

## Schéma Neon

La migration de référence est `neon/migrations/20261108_0001_initial.sql`. Elle crée les entités métier AcreMap, les clés étrangères, les index, les fonctions de contrôle et les politiques RLS. Le registre `public.acremap_schema_migrations` trace les versions appliquées.

Les anciennes migrations `supabase/migrations` sont conservées comme historique de l'ancien backend; elles ne doivent pas être exécutées sur Neon.

## Stockage des fichiers

Les buckets Neon sont privés. Le navigateur demande une URL présignée à `/api/storage/presign`, puis transfère directement le fichier vers le bucket. Les clés S3 restent exclusivement dans l'environnement serveur.

## Intégration CRM

AcreMap expose `/api/v1/integration` :
- `GET ?resource=health` : état de l'API et de la base.
- `GET ?resource=owners` : propriétaires synchronisés depuis le CRM.
- `GET ?resource=plans` : plans et lots à synchroniser dans le CRM.
- `POST` avec `{ "event": "owners.sync", "owners": [...] }` : import/upsert idempotent des propriétaires.

Les appels CRM utilisent une clé Bearer pour l'API et un secret HMAC pour les webhooks. Les paramètres de développement sont séparés; la synchronisation de développement reste désactivée tant que les tests bout en bout ne sont pas validés.

Le CRM reste la référence des propriétaires; AcreMap est la référence des levés, géométries, superficies et plans de morcellement.

## Déploiement

Le projet Vercel utilise le dépôt officiel `AgriCapital-Web/AcreMap`. Les variables d'environnement doivent être définies séparément par cible et branche Git. Ne jamais committer de secrets, de clés S3 ou de mots de passe PostgreSQL.
