# AcreMap

Application AgriCapital de gestion cartographique, levés GPS, parcelles, morcellements et exports SIG.

## Développement
- Node.js 24.x
- Installer : `npm install`
- Développement : `npm run dev`
- Vérification TypeScript : `npm run check`
- Compilation : `npm run build`
- Lint : `npm run lint`

## Variables d'environnement
Copiez `.env.example` vers `.env.local` et renseignez le projet Supabase réellement utilisé. Configurez les variables serveur dans l'environnement de déploiement.
- `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` : navigateur.
- `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` : serveur.
- `SUPABASE_SERVICE_ROLE_KEY` : serveur uniquement, jamais préfixée par `VITE_` et jamais committée.
- `GOOGLE_MAPS_API_KEY` : intégration cartographique facultative.
- `ACREMAP_CRM_API_KEY`, `CRM_WEBHOOK_URL`, `CRM_WEBHOOK_SECRET` : intégration CRM, côté serveur uniquement.

Les valeurs de `.env.example` sont des espaces réservés, pas des clés fonctionnelles. Ne jamais committer de secrets.

## Morcellement interne
Le moteur géométrique s'exécute dans l'application à partir des relevés GPS, avec Turf.js embarqué. Aucun modèle IA, crédit IA ou service distant ne calcule les lots. Le moteur valide le périmètre, calcule les surfaces, construit les lots et voies, conserve les reliquats et contrôle le bilan surfacique. Les exports PDF, CSV, DXF, GeoJSON, KML et Shapefile sont générés côté navigateur.

L'aide technique est un moteur de règles local déterministe : elle ne transmet pas les questions à un fournisseur externe.

## Données hors ligne
IndexedDB/Dexie sert de stockage local et de cache. La file d'attente synchronise les changements pris en charge avec Supabase à la reconnexion. Les lectures cloud sont paginées pour éviter de tronquer les tables volumineuses.

## SQL à exécuter
Toutes les instructions SQL pour l'intégration AcreMap ↔ CRM sont regroupées dans [`plan.md`](./plan.md). Exécutez le SQL AcreMap dans le projet Supabase réellement utilisé par AcreMap, pas dans la base CRM.

## Déploiement
Dépôt officiel : `AgriCapital-Web/AcreMap`, branche `Principal`. Le projet Vercel doit utiliser Node.js 24.x, `npm ci` et les variables serveur configurées.

## API d'intégration CRM
AcreMap expose `/api/v1/integration`. Les requêtes partenaires utilisent `Authorization: Bearer <ACREMAP_CRM_API_KEY>`.
- `GET /api/v1/integration?resource=health` : état du service.
- `GET /api/v1/integration?resource=owners` : propriétaires synchronisés depuis le CRM.
- `POST /api/v1/integration` avec `{ "event": "owners.sync", "owners": [...] }` : import/upsert idempotent des propriétaires.
- `GET /api/v1/integration?resource=plans` : plans et lots à synchroniser dans le CRM.

Le CRM reste la référence des propriétaires ; AcreMap est la référence des levés, géométries et superficies mesurées. Les secrets ne sont jamais exposés au navigateur.
