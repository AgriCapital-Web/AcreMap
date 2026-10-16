import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// Configuration Vite autonome pour le déploiement Vercel avec Nitro.
// Le serveur personnalisé conserve la gestion d'erreurs SSR d'AcreMap.
export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    nitro(),
    react(),
    tsConfigPaths(),
  ],
});
