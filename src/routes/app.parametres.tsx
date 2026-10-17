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
  ["SUPABASE_ACCESS_TOKEN", "Jeton limité au projet pour exécuter les migrations"],
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
      const result = await migrate();
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
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">Configurez la synchronisation bidirectionnelle AcreMap ↔ CRM, vérifiez les secrets serveur et lancez les migrations de base de données.</p>
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
      <p className="text-sm">La migration est versionnée et conçue pour être relancée sans dupliquer les objets. Elle exige <code>SUPABASE_ACCESS_TOKEN</code> côté serveur Vercel, avec un jeton Supabase limité au projet AcreMap et autorisé en écriture sur la base. Aucun SQL libre n’est accepté depuis le navigateur.</p>
      <div className="rounded-lg bg-muted/60 p-3 text-sm">
        <p className="font-semibold">Préparer le jeton une seule fois</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Dans Supabase, créez un jeton d’accès à portée limitée au projet AcreMap.</li>
          <li>Accordez uniquement l’accès Database en écriture nécessaire à la migration.</li>
          <li>Dans Vercel → projet <b>acremap</b> → Settings → Environment Variables, ajoutez <code>SUPABASE_ACCESS_TOKEN</code> et <code>SUPABASE_PROJECT_REF=ckkjqpsoavrikgiuuktf</code> pour Production.</li>
          <li>Redéployez, revenez ici et cliquez sur « Exécuter la migration ».</li>
        </ol>
      </div>
    </section>

    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-semibold">2. État des variables serveur</h2><p className="mt-1 text-sm text-muted-foreground">Les valeurs ne sont jamais affichées ; seul leur état est contrôlé.</p></div>
        <button onClick={() => void refresh()} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">Actualiser</button>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
        {VARS.map(([key, label]) => <div key={key} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1"><div className="break-all font-mono text-xs sm:text-sm">{key}</div><div className="mt-1 break-words text-xs text-muted-foreground">{label}</div></div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${checks?.[key] ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{checks ? (checks[key] ? "Configurée" : "Manquante") : "Vérification…"}</span>
        </div>)}
      </div>
      <p className="text-sm text-muted-foreground">Après avoir ajouté ou modifié une variable Vercel, un nouveau déploiement est nécessaire. Ne placez jamais la clé service role ou le jeton de gestion dans une variable <code>VITE_*</code>.</p>
    </section>

    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <h2 className="text-lg font-semibold">3. Générer les secrets AcreMap ↔ CRM</h2>
      <p className="text-sm text-muted-foreground">Les deux secrets sont générés localement dans cette page. Copiez-les immédiatement : ils ne sont pas sauvegardés automatiquement et ne peuvent pas être récupérés après rechargement.</p>
      <button onClick={generate} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground sm:w-auto">Générer une clé API et un secret HMAC</button>
      {showSecrets && <>
        <div className="min-w-0 space-y-2">
          <label className="block text-sm font-medium">ACREMAP_CRM_API_KEY</label>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row"><input readOnly value={apiKey} className="min-w-0 w-full flex-1 rounded-lg border bg-muted px-3 py-2 font-mono text-xs" /><button onClick={() => void copy("api", apiKey)} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">{copied === "api" ? "Copié" : "Copier"}</button></div>
          <p className="text-xs text-muted-foreground">Ajoutez cette valeur dans Vercel/AcreMap et dans CRM → Paramètres → AcreMap API → Clé API AcreMap.</p>
        </div>
        <div className="min-w-0 space-y-2">
          <label className="block text-sm font-medium">CRM_WEBHOOK_SECRET</label>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row"><input readOnly value={webhookSecret} className="min-w-0 w-full flex-1 rounded-lg border bg-muted px-3 py-2 font-mono text-xs" /><button onClick={() => void copy("hmac", webhookSecret)} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">{copied === "hmac" ? "Copié" : "Copier"}</button></div>
          <p className="text-xs text-muted-foreground">Ajoutez la même valeur dans Vercel/AcreMap et dans CRM → Paramètres → AcreMap API → Secret HMAC webhook.</p>
        </div>
      </>}
    </section>

    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <h2 className="text-lg font-semibold">4. Adresses de connexion</h2>
      <div className="space-y-1"><label className="text-sm font-medium">URL de base AcreMap à saisir dans le CRM</label><div className="flex min-w-0 flex-col gap-2 sm:flex-row"><input readOnly value={ACREMAP_BASE_URL} className="min-w-0 w-full flex-1 rounded-lg border bg-muted px-3 py-2 text-xs" /><button onClick={() => void copy("base", ACREMAP_BASE_URL)} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">{copied === "base" ? "Copié" : "Copier"}</button></div></div>
      <div className="space-y-1"><label className="text-sm font-medium">URL webhook CRM (variable CRM_WEBHOOK_URL côté Vercel AcreMap)</label><div className="flex min-w-0 flex-col gap-2 sm:flex-row"><input readOnly value={CRM_WEBHOOK_URL} className="min-w-0 w-full flex-1 rounded-lg border bg-muted px-3 py-2 text-xs" /><button onClick={() => void copy("url", CRM_WEBHOOK_URL)} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">{copied === "url" ? "Copié" : "Copier"}</button></div></div>
    </section>

    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <h2 className="text-lg font-semibold">5. Procédure de synchronisation</h2>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Configurez les variables serveur dans Vercel/AcreMap : <code>SUPABASE_URL</code>, <code>SUPABASE_PUBLISHABLE_KEY</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>ACREMAP_CRM_API_KEY</code>, <code>CRM_WEBHOOK_URL</code> et <code>CRM_WEBHOOK_SECRET</code>.</li>
        <li>Générez les secrets ci-dessus et copiez la clé API et le secret HMAC dans Vercel, puis dans CRM → Paramètres → AcreMap API. Les valeurs doivent correspondre exactement.</li>
        <li>Redéployez AcreMap après la configuration des variables, puis cliquez sur « Synchroniser les propriétaires » dans les paramètres du CRM.</li>
        <li>Dans AcreMap, créez/publiez un plan de morcellement puis vérifiez dans le CRM les lots, superficies et parts AgriCapital/propriétaire.</li>
      </ol>
    </section>
  </div>;
}
