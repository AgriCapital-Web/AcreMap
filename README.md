# AcreMap

Application AgriCapital de gestion cartographique, levés GPS, parcelles et morcellements.

## Développement

- Node.js compatible avec Vite 7
- Installer les dépendances : `npm install`
- Lancer en local : `npm run dev`
- Vérifier les types : `npm run check`
- Construire : `npm run build`

## Configuration requise

Configurer les variables d'environnement Supabase et, selon les fonctionnalités activées, les clés des services externes dans l'environnement de déploiement. Ne jamais committer de secrets.

Le projet est autonome et ne nécessite pas Lovable. La base Supabase et ses migrations restent distinctes du fournisseur d'éditeur.
