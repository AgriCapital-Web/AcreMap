import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { getIntegrationEnvironmentStatus } from "@/lib/integration-admin.functions";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/app/parametres")({
  component: IntegrationSettingsPage,
  head: () => ({ meta: [{ title: "Paramètres & intégrations — AcreMap" }] }),
});

type Checks = Record<string, boolean>;
const CRM_WEBHOOK_URL = "https://rfzfsmpsuempafhkqhra.supabase.co/functions/v1/acremap-webhook";
const ACREMAP_BASE_URL = "https://acremap.agricapital.ci";
const VARS = [
  ["SUPABASE_URL", "URL du projet Supabase AcreMap"],
  ["SUPABASE_SERVICE_ROLE_KEY", "Clé service_role Supabase AcreMap (secret serveur)"],
  ["ACREMAP_CRM_API_KEY", "Clé API Bearer AcreMap"],
  ["CRM_WEBHOOK_URL", "URL du webhook entrant CRM"],
  ["CRM_WEBHOOK_SECRET", "Secret HMAC partagé"],
] as const;

function makeSecret(prefix = "") {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return prefix + hex;
}

function IntegrationSettingsPage() {
  const user = useAuth((s) => s.user);
  const getStatus = useServerFn(getIntegrationEnvironmentStatus);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [copied, setCopied] = useState("");

  async function refresh() {
    setError("");
    try { const result = await getStatus(); setChecks(result.checks); }
    catch (e) { setError(e instanceof Error ? e.message : "Statut indisponible"); }
  }
  useEffect(() => { if (user?.role === "admin") void refresh(); }, [user?.id]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 2200);
    } catch { setError("Copie automatique indisponible : sélectionnez puis copiez la valeur manuellement."); }
  }
  function generate() {
    setApiKey(makeSecret("acremap_live_"));
    setWebhookSecret(makeSecret("acremap_hmac_"));
    setShowSecrets(true);
  }

  if (!user) return null;
  if (user.role !== "admin") return <div className="p-6 text-center">Accès réservé à l’administrateur principal.</div>;

  return <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <div>
      <h1 className="text-2xl font-bold">Paramètres & intégrations</h1>
      <p className="mt-1 text-sm text-muted-foreground">Configuration sécurisée de la connexion bidirectionnelle AcreMap ↔ CRM.</p>
    </div>
    {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">État des variables serveur</h2>
        <button onClick={() => void refresh()} className="rounded-lg border px-3 py-2 text-sm">Actualiser</button>
      </div>
      <p className="text-sm text-muted-foreground">Ces contrôles ne révèlent jamais les valeurs secrètes. Configurez les variables dans Vercel → projet <b>acremap</b> → Settings → Environment Variables, puis redéployez.</p>
      <div className="space-y-2">
        {VARS.map(([key, label]) => <div key={key} className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0"><div className="font-mono text-xs sm:text-sm break-all">{key}</div><div className="text-xs text-muted-foreground">{label}</div></div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${checks?.[key] ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{checks ? (checks[key] ? "Configurée" : "Manquante") : "Vérification…"}</span>
        </div>)}
      </div>
      {checks && Object.values(checks).some((v) => !v) && <p className="text-sm text-red-700">La synchronisation complète ne fonctionnera pas tant que des variables sont manquantes. Ne placez jamais la clé service_role dans une variable VITE_*.</p>}
    </section>
    <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
      <h2 className="text-lg font-semibold">Générer les secrets d’intégration</h2>
      <p className="text-sm text-muted-foreground">Générez les deux secrets, copiez-les immédiatement et configurez-les des deux côtés. Ils ne sont ni enregistrés dans la base ni conservés après fermeture/rechargement de cette page.</p>
      <button onClick={generate} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Générer une clé API et un secret HMAC</button>
      {showSecrets && <>
        <div className="space-y-2">
          <label className="block text-sm font-medium">ACREMAP_CRM_API_KEY</label>
          <div className="flex gap-2"><input readOnly value={apiKey} className="min-w-0 flex-1 rounded-lg border bg-muted px-3 py-2 font-mono text-xs" /><button onClick={() => void copy("api", apiKey)} className="rounded-lg border px-3 text-sm">{copied === "api" ? "Copié" : "Copier"}</button></div>
          <p className="text-xs text-muted-foreground">À ajouter dans Vercel (AcreMap) et dans CRM → Paramètres → AcreMap API → Clé API AcreMap.</p>
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium">CRM_WEBHOOK_SECRET</label>
          <div className="flex gap-2"><input readOnly value={webhookSecret} className="min-w-0 flex-1 rounded-lg border bg-muted px-3 py-2 font-mono text-xs" /><button onClick={() => void copy("hmac", webhookSecret)} className="rounded-lg border px-3 text-sm">{copied === "hmac" ? "Copié" : "Copier"}</button></div>
          <p className="text-xs text-muted-foreground">À ajouter dans Vercel (AcreMap) et dans le champ « Secret HMAC webhook » du CRM. Les valeurs doivent être strictement identiques.</p>
        </div>
      </>}
    </section>
    <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
      <h2 className="text-lg font-semibold">Valeurs de connexion</h2>
      <p className="text-sm">Domaine officiel AcreMap : <a className="underline break-all" href={ACREMAP_BASE_URL}>{ACREMAP_BASE_URL}</a></p>
      <div className="space-y-1"><label className="text-sm font-medium">URL de base AcreMap à mettre dans le CRM</label><div className="flex gap-2"><input readOnly value={ACREMAP_BASE_URL} className="min-w-0 flex-1 rounded-lg border bg-muted px-3 py-2 text-xs" /><button onClick={() => void copy("base", ACREMAP_BASE_URL)} className="rounded-lg border px-3 text-sm">{copied === "base" ? "Copié" : "Copier"}</button></div></div>
      <div className="space-y-1"><label className="text-sm font-medium">URL webhook CRM à mettre dans CRM_WEBHOOK_URL (Vercel AcreMap)</label><div className="flex gap-2"><input readOnly value={CRM_WEBHOOK_URL} className="min-w-0 flex-1 rounded-lg border bg-muted px-3 py-2 text-xs" /><button onClick={() => void copy("url", CRM_WEBHOOK_URL)} className="rounded-lg border px-3 text-sm">{copied === "url" ? "Copié" : "Copier"}</button></div></div>
    </section>
    <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
      <h2 className="text-lg font-semibold">Ordre de configuration</h2>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Dans Vercel/AcreMap, renseignez <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>ACREMAP_CRM_API_KEY</code>, <code>CRM_WEBHOOK_URL</code> et <code>CRM_WEBHOOK_SECRET</code> pour Production. La clé service_role doit provenir du projet Supabase AcreMap et rester secrète.</li>
        <li>Dans le CRM, ouvrez <b>Paramètres → AcreMap API</b>, collez l’URL de base, la clé API et le secret HMAC, activez l’intégration puis enregistrez.</li>
        <li>Dans le CRM, cliquez sur « Synchroniser les propriétaires » ; ils doivent apparaître dans le formulaire de morcellement AcreMap.</li>
        <li>Publiez un plan de morcellement connecté, puis vérifiez dans le CRM que les lots, les surfaces et les parts AgriCapital/propriétaire sont reçus.</li>
        <li>Après toute modification des variables Vercel, relancez un déploiement Production pour charger les secrets côté serveur.</li>
      </ol>
    </section>
  </div>;
}
