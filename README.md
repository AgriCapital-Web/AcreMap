# AcreMap

Application AgriCapital de gestion cartographique, levés GPS, parcelles, morcellements et exports SIG.

## Développement
- Node.js 22+
- Installer : `npm install`
- Développement : `npm run dev`
- Vérification TypeScript : `npm run check`
- Compilation : `npm run build`
- Lint : `npm run lint`

## Variables d'environnement
Copiez `.env.example` vers `.env.local` et renseignez le projet Supabase réellement utilisé. Configurez les mêmes variables dans l'environnement de déploiement.
- `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` : navigateur.
- `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` : serveur.
- `SUPABASE_SERVICE_ROLE_KEY` : serveur uniquement, jamais préfixée par `VITE_` et jamais committée.
- `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` : assistant IA facultatif via une API compatible OpenAI.
- `GOOGLE_MAPS_API_KEY` : intégration Google Maps facultative.

Les valeurs de `.env.example` sont des espaces réservés, pas des clés fonctionnelles. AcreMap ne dépend pas de Lovable.

## Données hors ligne
IndexedDB/Dexie sert de cache local et la file d'attente synchronise les changements avec Supabase à la reconnexion. Les lectures cloud sont paginées pour éviter de tronquer les tables volumineuses.

## Déploiement
Dépôt officiel : `AgriCapital-Web/AcreMap`, branche `Principal`. Vérifiez que Vercel est relié à ce dépôt et que les variables d'environnement sont configurées.

## Morcellement et exports
Le moteur valide le périmètre GPS, conserve les reliquats, mesure les superficies et contrôle le bilan surfacique global. Les exports PDF, CSV, DXF, GeoJSON, KML et Shapefile sont générés côté navigateur.


## API d'intégration CRM
AcreMap expose `/api/v1/integration`. Les requêtes partenaires utilisent `Authorization: Bearer <ACREMAP_CRM_API_KEY>`; la clé reste côté serveur.
- `GET /api/v1/integration?resource=health` : état du service.
- `GET /api/v1/integration?resource=owners` : propriétaires synchronisés depuis le CRM.
- `POST /api/v1/integration` avec `{ "event": "owners.sync", "owners": [...] }` : import/upsert idempotent des propriétaires du CRM.
- `GET /api/v1/integration?resource=plans` : plans et lots à synchroniser dans le CRM.
Le CRM reste la source de vérité des propriétaires ; AcreMap est la source de vérité des levés, géométries et superficies mesurées. Ne jamais exposer les clés API dans le navigateur.
