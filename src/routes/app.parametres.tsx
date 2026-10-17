import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { getIntegrationEnvironmentStatus } from "@/lib/integration-admin.functions";
import { runAcreMapMigrations } from "@/lib/migrations.functions";
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
  ["SUPABASE_PUBLISHABLE_KEY", "Clé publique Supabase côté serveur"],
  ["VITE_SUPABASE_URL", "URL Supabase utilisée par le navigateur"],
  ["VITE_SUPABASE_PUBLISHABLE_KEY", "Clé publique utilisée par le navigateur"],
  ["SUPABASE_SERVICE_ROLE_KEY", "Clé secrète serveur pour les opérations d’administration"],
  ["SUPABASE_ACCESS_TOKEN", "Jeton Supabase Management API pour exécuter les migrations"],
  ["SUPABASE_PROJECT_REF", "Référence du projet Supabase cible des migrations"],
  ["ACREMAP_CRM_API_KEY", "Clé Bearer utilisée par le CRM pour envoyer les propriétaires"],
  ["CRM_WEBHOOK_URL", "Adresse du webhook entrant dans le CRM"],
  ["CRM_WEBHOOK_SECRET", "Secret HMAC partagé avec le CRM"],
] as const;

function makeSecret(prefix = "") {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function IntegrationSettingsPage() {
  const user = useAuth((s) => s.user);
  const getStatus = useServerFn(getIntegrationEnvironmentStatus);
  const migrate = useServerFn(runAcreMapMigrations);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [copied, setCopied] = useState("");
  const [migrating, setMigrating] = useState(false);

  async function refresh() {
    setError("");
    try {
      const result = await getStatus();
      setChecks(result.checks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Statut indisponible");
    }
  }
  useEffect(() => { if (user?.role === "admin") void refresh(); }, [user?.id]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 2200);
    } catch {
      setError("Copie automatique indisponible : sélectionnez puis copiez la valeur manuellement.");
    }
  }
  function generate() {
    setApiKey(makeSecret("acremap_live_"));
    setWebhookSecret(makeSecret("acremap_hmac_"));
    setShowSecrets(true);
    setSuccess("");
  }
  async function runMigration() {
    if (!confirm("Exécuter la migration AcreMap sur la base de production ? Cette opération crée/complète les objets manquants de manière idempotente.")) return;
    setMigrating(true);
    setError("");
    setSuccess("");
    try {
      const result = await migrate({ data: {} });
      setSuccess(result.message);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La migration a échoué.");
    } finally {
      setMigrating(false);
    }
  }

  if (!user) return null;
  if (user.role !== "admin") return <div className="mx-auto max-w-xl p-4 sm:p-8 text-center">Accès réservé à l’administrateur principal.</div>;

  return <div className="mx-auto w-full max-w-5xl min-w-0 space-y-4 p-3 sm:space-y-6 sm:p-6 lg:p-8">
    <header className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Administration</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Paramètres & intégrations</h1>
    </header>

    {error && <div role="alert" className="break-words rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {success && <div role="status" className="break-words rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">{success}</div>}

    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-semibold">1. Migration de la base AcreMap</h2><p className="mt-1 text-sm text-muted-foreground">Tables, colonne propriétaire, relation, politiques RLS et bucket privé « imports ».</p></div>
        <button disabled={migrating} onClick={() => void runMigration()} className="w-full shrink-0 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:w-auto">
          {migrating ? "Migration en cours…" : "Exécuter la migration"}
        </button>
      </div>
    </section>

    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-semibold">2. Variables serveur</h2></div>
        <button onClick={() => void refresh()} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">Actualiser</button>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
        {VARS.map(([key, label]) => <div key={key} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1"><div className="break-all font-mono text-xs sm:text-sm">{key}</div><div className="mt-1 break-words text-xs text-muted-foreground">{label}</div></div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${checks?.[key] ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{checks ? (checks[key] ? "Configurée" : "Manquante") : "Vérification…"}</span>
        </div>)}
      </div>
    </section>

    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <h2 className="text-lg font-semibold">3. Générer les secrets AcreMap ↔ CRM</h2>
      <button onClick={generate} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground sm:w-auto">Générer une clé API et un secret HMAC</button>
      {showSecrets && <>
        <div className="min-w-0 space-y-2">
          <label className="block text-sm font-medium">ACREMAP_CRM_API_KEY</label>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row"><input readOnly value={apiKey} className="min-w-0 w-full flex-1 rounded-lg border bg-muted px-3 py-2 font-mono text-xs" /><button onClick={() => void copy("api", apiKey)} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">{copied === "api" ? "Copié" : "Copier"}</button></div>
        </div>
        <div className="min-w-0 space-y-2">
          <label className="block text-sm font-medium">CRM_WEBHOOK_SECRET</label>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row"><input readOnly value={webhookSecret} className="min-w-0 w-full flex-1 rounded-lg border bg-muted px-3 py-2 font-mono text-xs" /><button onClick={() => void copy("hmac", webhookSecret)} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">{copied === "hmac" ? "Copié" : "Copier"}</button></div>
        </div>
      </>}
    </section>

    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <h2 className="text-lg font-semibold">4. Connexions</h2>
      <div className="space-y-1"><label className="text-sm font-medium">URL AcreMap</label><div className="flex min-w-0 flex-col gap-2 sm:flex-row"><input readOnly value={ACREMAP_BASE_URL} className="min-w-0 w-full flex-1 rounded-lg border bg-muted px-3 py-2 text-xs" /><button onClick={() => void copy("base", ACREMAP_BASE_URL)} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">{copied === "base" ? "Copié" : "Copier"}</button></div></div>
      <div className="space-y-1"><label className="text-sm font-medium">Webhook CRM</label><div className="flex min-w-0 flex-col gap-2 sm:flex-row"><input readOnly value={CRM_WEBHOOK_URL} className="min-w-0 w-full flex-1 rounded-lg border bg-muted px-3 py-2 text-xs" /><button onClick={() => void copy("url", CRM_WEBHOOK_URL)} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">{copied === "url" ? "Copié" : "Copier"}</button></div></div>
    </section>

  </div>;
}
