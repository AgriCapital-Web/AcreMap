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
  ["ACREMAP_CRM_API_KEY_DEV", "Clé API CRM → AcreMap"],
  ["CRM_WEBHOOK_URL_DEV", "Webhook AcreMap → CRM"],
  ["CRM_WEBHOOK_SECRET_DEV", "Secret HMAC partagé"],
  ["CRM_INTEGRATION_ENABLED_DEV", "Drapeau d'activation de l'intégration"],
] as const;

function IntegrationSettingsPage() {
  const user = useAuth((s) => s.user);
  const getStatus = useServerFn(getIntegrationEnvironmentStatus);
  const verifySchema = useServerFn(runAcreMapMigrations);
  const [checks, setChecks] = useState<Record<string, boolean> | null>(null);
  const [crmEnabled, setCrmEnabled] = useState(false);
  const [schema, setSchema] = useState<{ version: string; appliedAt: string; message: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError("");
    try {
      const result = await getStatus();
      setChecks(result.checks);
      setCrmEnabled(result.crmEnabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Statut indisponible");
    }
  }
  useEffect(() => { if (user?.role === "admin") void refresh(); }, [user?.id]);

  async function checkSchema() {
    setBusy(true);
    setError("");
    try {
      const result = await verifySchema({ data: {} });
      setSchema(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vérification Neon impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;
  if (user.role !== "admin") return <div className="mx-auto max-w-xl p-4 sm:p-8 text-center">Accès réservé à l’administrateur principal.</div>;

  return <div className="mx-auto w-full max-w-5xl min-w-0 space-y-4 p-3 sm:space-y-6 sm:p-6 lg:p-8">
    <header>
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Administration</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Paramètres & intégrations</h1>
      <p className="mt-2 text-sm text-muted-foreground">Environnement de développement — Neon, stockage privé et liaison CRM.</p>
    </header>

    {error && <div role="alert" className="break-words rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {schema && <div role="status" className="break-words rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">{schema.message}<div className="mt-1 text-xs">Appliquée le {new Date(schema.appliedAt).toLocaleString()}</div></div>}

    <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-semibold">1. Base de données Neon</h2><p className="mt-1 text-sm text-muted-foreground">Vérification du schéma, des relations et des politiques RLS sur la branche de développement.</p></div>
        <button disabled={busy} onClick={() => void checkSchema()} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:w-auto">{busy ? "Vérification…" : "Vérifier le schéma Neon"}</button>
      </div>
    </section>

    <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-semibold">2. Variables d'environnement</h2><p className="mt-1 text-sm text-muted-foreground">Seuls les états de présence sont affichés. Aucune clé ni valeur secrète n'est exposée.</p></div>
        <button onClick={() => void refresh()} className="w-full rounded-lg border px-3 py-2 text-sm sm:w-auto">Actualiser</button>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
        {VARS.map(([key, label]) => <div key={key} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1"><div className="break-all font-mono text-xs sm:text-sm">{key}</div><div className="mt-1 break-words text-xs text-muted-foreground">{label}</div></div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${checks?.[key] ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{checks ? (checks[key] ? "Configurée" : "Manquante") : "Vérification…"}</span>
        </div>)}
      </div>
    </section>

    <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">3. Intégration CRM</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${crmEnabled ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{crmEnabled ? "Activée" : "Configurée — désactivée en développement"}</span>
      </div>
      <p className="text-sm text-muted-foreground">Les clés de développement sont préparées. Les échanges de données restent désactivés pour éviter d'envoyer des données réelles du CRM dans la base de test. La configuration de production n'est pas modifiée.</p>
      <p className="text-xs text-muted-foreground">Domaine de production réservé au futur basculement : https://acremap.agricapital.ci</p>
    </section>
  </div>;
}
