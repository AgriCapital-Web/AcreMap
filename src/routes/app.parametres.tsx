import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { getIntegrationEnvironmentStatus, getCrmIntegrationSettings, generateCrmIntegrationCredentials, saveCrmIntegrationSettings } from "@/lib/integration-admin.functions";
import { runAcreMapMigrations } from "@/lib/migrations.functions";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/app/parametres")({
  component: IntegrationSettingsPage,
  head: () => ({ meta: [{ title: "Paramètres & intégrations — AcreMap" }] }),
});

const VARS = [
  ["NEON_DATABASE_URL_DEV", "Connexion PostgreSQL Neon — serveur"],
  ["VITE_NEON_AUTH_URL_DEV", "Neon Managed Better Auth"],
  ["VITE_NEON_DATA_API_URL_DEV", "Neon Data API"],
  ["NEON_PROJECT_ID_DEV", "Projet Neon AcreMap"],
  ["NEON_BRANCH_ID_DEV", "Branche Neon de développement"],
  ["AWS_ACCESS_KEY_ID_DEV", "Identifiant S3 Neon"],
  ["AWS_SECRET_ACCESS_KEY_DEV", "Secret S3 Neon"],
  ["AWS_ENDPOINT_URL_S3_DEV", "Endpoint Neon Object Storage"],
  ["AWS_REGION_DEV", "Région de stockage"],
] as const;

function IntegrationSettingsPage() {
  const user = useAuth((s) => s.user);
  const getStatus = useServerFn(getIntegrationEnvironmentStatus);
  const getCrm = useServerFn(getCrmIntegrationSettings);
  const generateCredentials = useServerFn(generateCrmIntegrationCredentials);
  const saveCrm = useServerFn(saveCrmIntegrationSettings);
  const verifySchema = useServerFn(runAcreMapMigrations);
  const [checks, setChecks] = useState<Record<string, boolean> | null>(null);
  const [crm, setCrm] = useState<{ apiBaseUrl: string; webhookUrl: string; enabled: boolean; hasApiKey: boolean; hasWebhookSecret: boolean } | null>(null);
  const [credentials, setCredentials] = useState<{ apiKey: string; webhookSecret: string; apiBaseUrl: string; webhookUrl: string } | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("https://rfzfsmpsuempafhkqhra.supabase.co/functions/v1/acremap-webhook");
  const [crmEnabled, setCrmEnabled] = useState(false);
  const [schema, setSchema] = useState<{ version: string; appliedAt: string; message: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError("");
    try {
      const [status, settings] = await Promise.all([getStatus(), getCrm()]);
      setChecks(status.checks);
      setCrm(settings);
      setWebhookUrl(settings.webhookUrl);
      setCrmEnabled(settings.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Statut indisponible");
    }
  }
  useEffect(() => { if (user?.role === "admin") void refresh(); }, [user?.id]);

  async function checkSchema() {
    setBusy(true); setError(""); setNotice("");
    try { setSchema(await verifySchema()); }
    catch (e) { setError(e instanceof Error ? e.message : "Vérification Neon impossible."); }
    finally { setBusy(false); }
  }

  async function createCredentials() {
    setBusy(true); setError(""); setNotice("");
    try {
      const value = await generateCredentials();
      setCredentials(value);
      await refresh();
      setNotice("Les nouvelles clés sont prêtes. Copiez-les maintenant : elles ne seront plus affichées après avoir quitté cette page. La clé API précédente a été révoquée.");
    } catch (e) { setError(e instanceof Error ? e.message : "Génération des clés impossible."); }
    finally { setBusy(false); }
  }

  async function saveSettings() {
    setBusy(true); setError(""); setNotice("");
    try {
      await saveCrm({ data: { webhookUrl, enabled: crmEnabled } });
      await refresh();
      setNotice(crmEnabled ? "Configuration AcreMap activée. Activez aussi l'intégration dans les paramètres du CRM après y avoir enregistré les deux clés." : "Configuration enregistrée et intégration suspendue.");
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  if (!user) return null;
  if (user.role !== "admin") return <div className="mx-auto max-w-xl p-4 sm:p-8 text-center">Accès réservé à l’administrateur principal.</div>;

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setNotice("Copié dans le presse-papiers.");
  };

  return <div className="mx-auto w-full max-w-5xl min-w-0 space-y-4 p-3 sm:space-y-6 sm:p-6 lg:p-8">
    <header>
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Administration</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Paramètres & intégrations</h1>
      <p className="mt-2 text-sm text-muted-foreground">Neon est la base principale. Gérez ici les échanges sécurisés avec AgriCapital CRM.</p>
    </header>

    {error && <div role="alert" className="break-words rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="break-words rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">{notice}</div>}
    {schema && <div role="status" className="break-words rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">{schema.message}<div className="mt-1 text-xs">Appliquée le {new Date(schema.appliedAt).toLocaleString()}</div></div>}

    <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-semibold">1. Base de données Neon</h2><p className="mt-1 text-sm text-muted-foreground">Vérification du schéma, des relations et des politiques RLS.</p></div>
        <button disabled={busy} onClick={() => void checkSchema()} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:w-auto">{busy ? "Vérification…" : "Vérifier le schéma Neon"}</button>
      </div>
    </section>

    <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-semibold">2. Variables d'environnement</h2><p className="mt-1 text-sm text-muted-foreground">Seuls les états de présence sont affichés.</p></div>
        <button onClick={() => void refresh()} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">Actualiser</button>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
        {VARS.map(([key, label]) => <div key={key} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1"><div className="break-all font-mono text-xs sm:text-sm">{key}</div><div className="mt-1 break-words text-xs text-muted-foreground">{label}</div></div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${checks?.[key] ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{checks ? (checks[key] ? "Configurée" : "Manquante") : "Vérification…"}</span>
        </div>)}
      </div>
    </section>

    <section className="space-y-4 rounded-xl border bg-card p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">3. Connexion AgriCapital CRM</h2><p className="mt-1 text-sm text-muted-foreground">API entrante CRM → AcreMap et webhook sortant AcreMap → CRM.</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${crm?.enabled ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{crm?.enabled ? "Activée côté AcreMap" : "En attente de configuration"}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">API AcreMap</p><p className="mt-1 break-all font-mono text-sm">{crm?.apiBaseUrl ?? "https://acremap.agricapital.ci"}</p><p className="mt-2 text-xs text-muted-foreground">{crm?.hasApiKey ? "Clé API active" : "Aucune clé API"}</p></div>
        <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Webhook CRM</p><p className="mt-1 break-all font-mono text-sm">{webhookUrl}</p><p className="mt-2 text-xs text-muted-foreground">{crm?.hasWebhookSecret ? "Secret HMAC enregistré" : "Secret HMAC manquant"}</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => void createCredentials()} className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? "Traitement…" : "Générer / renouveler les clés API et HMAC"}</button>
      </div>
      {credentials && <div className="space-y-3 rounded-lg border border-primary/30 p-3">
        <div><p className="font-semibold text-sm">Clé API AcreMap — à saisir dans le CRM</p><div className="mt-1 flex gap-2"><input readOnly value={credentials.apiKey} className="min-w-0 flex-1 rounded-md border bg-muted px-2 py-2 font-mono text-xs"/><button onClick={() => void copy(credentials.apiKey)} className="rounded-md border px-3 text-sm">Copier</button></div></div>
        <div><p className="font-semibold text-sm">Secret HMAC — à saisir dans le CRM</p><div className="mt-1 flex gap-2"><input readOnly value={credentials.webhookSecret} className="min-w-0 flex-1 rounded-md border bg-muted px-2 py-2 font-mono text-xs"/><button onClick={() => void copy(credentials.webhookSecret)} className="rounded-md border px-3 text-sm">Copier</button></div></div>
        <p className="text-xs text-muted-foreground">Ces valeurs ne sont affichées qu'à cette occasion. Dans le CRM, ouvrez Paramètres → AcreMap API, renseignez l'URL de base, la clé API et le secret HMAC, puis enregistrez.</p>
      </div>}
      <div className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="crm-webhook-url">URL du webhook CRM</label>
        <input id="crm-webhook-url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm"/>
      </div>
      <label className="flex items-center gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" checked={crmEnabled} onChange={(e) => setCrmEnabled(e.target.checked)} /> Activer l'envoi des morcellements vers le CRM</label>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || !webhookUrl.trim()} onClick={() => void saveSettings()} className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60">Enregistrer la configuration</button>
      </div>
      <p className="text-xs text-muted-foreground">Le CRM doit aussi être activé dans son propre écran Paramètres → AcreMap API. La synchronisation des propriétaires se lance depuis cet écran.</p>
    </section>
  </div>;
}
