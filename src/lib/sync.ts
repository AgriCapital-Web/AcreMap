// Cloud sync — IndexedDB → Supabase, offline-safe.
// Strategy: every Dexie row is mirrored to Supabase on demand (idempotent upsert).
// Failures stay queued in the `outbox` table and are retried on `online` event.
import { supabase } from "@/integrations/supabase/client";
import { db, isBrowser, type OutboxEntry } from "./db";
import type { Domaine, Lot, Measurement, MorcPlan, Parcelle, SP } from "./types";

type TableName = OutboxEntry["table"];

// ---- Row mappers (local shape → Supabase row) ----
function toIso(ts?: number | null): string | null {
  if (!ts && ts !== 0) return null;
  return new Date(ts).toISOString();
}

function mapSp(row: SP, userId: string | null) {
  return {
    id: row.id, code: row.code, name: row.name,
    district: row.district ?? null, region: row.region ?? null, departement: row.departement ?? null,
    notes: row.notes ?? null, archived_at: toIso(row.archivedAt), created_by: userId,
    created_at: toIso(row.createdAt) ?? new Date().toISOString(),
  };
}
function mapDomaine(row: Domaine, userId: string | null) {
  return {
    id: row.id, code: row.code, name: row.name, sp_id: row.spId,
    description: row.description ?? null, notes: row.notes ?? null,
    archived_at: toIso(row.archivedAt), created_by: userId, created_at: toIso(row.createdAt) ?? new Date().toISOString(),
  };
}
function mapParcelle(row: Parcelle, userId: string | null) {
  const base = {
    id: row.id, code: row.code, owner_name: row.ownerName,
    owner_phone: row.ownerPhone ?? null, domaine_id: row.domaineId,
    convention_date: toIso(row.conventionDate), declared_area: row.declaredArea ?? null,
    convention_status: row.conventionStatus ?? null,
    owner_photo: row.ownerPhoto ?? null, group_photo: row.groupPhoto ?? null,
    parcelle_photo: row.parcellePhoto ?? null,
    notes: row.notes ?? null, archived_at: toIso(row.archivedAt), created_by: userId,
    created_at: toIso(row.createdAt) ?? new Date().toISOString(),
  };
  // `name` existe après l'exécution manuelle du SQL (colonne ajoutée à public.parcelles).
  return { ...base, name: row.name ?? null } as typeof base;
}
function mapMeasurement(row: Measurement, userId: string | null) {
  return {
    id: row.id, parcelle_id: row.parcelleId ?? null, status: row.status,
    area_m2: row.areaM2, perimeter_m: row.perimeterM, unit: row.unit,
    points: row.points as unknown, trace: row.trace as unknown,
    device_profile: (row.deviceProfile ?? null) as unknown,
    qa: (row.qa ?? null) as unknown,
    offline_created: row.offlineCreated ?? false,
    sync_state: row.syncState ?? "pending",
    synced_at: toIso(row.syncedAt),
    measured_at: toIso(row.createdAt),
    notes: row.notes ?? null,
    validated_by: row.validatedBy ?? null, validated_at: toIso(row.validatedAt),
    created_by: userId, created_at: toIso(row.createdAt) ?? new Date().toISOString(),
  };
}
function mapLot(row: Lot, userId: string | null) {
  return {
    id: row.id, parcelle_id: row.parcelleId, measurement_id: row.measurementId || null,
    code: row.code, polygon: row.polygon as unknown, bornes: (row.bornes ?? []) as unknown,
    area_m2: row.areaM2, is_reserve: row.isReserve ?? false,
    assignee_name: row.assigneeName ?? null, assignee_owner_id: row.assigneeOwnerId ?? null, assigned_at: toIso(row.assignedAt),
    plan_id: row.planId ?? null,
    part: row.part ?? "proprietaire",
    kind: row.kind ?? "lot",
    label: row.label ?? null,
    target_area_m2: row.targetAreaM2 ?? null,
    assignee_contact: row.assigneeContact ?? null,
    assignee_account: row.assigneeAccount ?? null,
    created_by: userId,
  };
}
function mapPlan(row: MorcPlan, userId: string | null) {
  return {
    id: row.id, parcelle_id: row.parcelleId, measurement_id: row.measurementId ?? null,
    reference: row.reference ?? null,
    config: row.config as unknown, score: row.score as unknown,
    target_m2: row.targetM2, total_m2: row.totalM2,
    conforme: row.conforme, status: row.status, notes: row.notes ?? null,
    created_by: userId, created_at: toIso(row.createdAt) ?? new Date().toISOString(),
  };
}

async function withNetworkTimeout<T>(promise:PromiseLike<T>,ms=60_000):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(promise),new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Réseau trop lent : opération conservée pour réessai.")),ms);})]);}finally{if(timer)clearTimeout(timer);}}
async function pushUpsert(table:TableName,payload:Record<string,unknown>):Promise<void>{
 const result=await withNetworkTimeout(supabase.from(table).upsert(payload as never,{onConflict:"id"}));
 if(!result.error)return;
 const msg=result.error.message??"";
 const metadataColumns=["offline_created","sync_state","synced_at","measured_at"];
 if(table==="measurements"&&metadataColumns.some(column=>msg.includes(column))&&(msg.toLowerCase().includes("column")||msg.toLowerCase().includes("schema cache"))){
  const compatible={...payload};for(const column of metadataColumns)delete compatible[column];
  const retry=await withNetworkTimeout(supabase.from(table).upsert(compatible as never,{onConflict:"id"}));
  if(retry.error)throw retry.error;
  return;
 }
 throw result.error;
}
async function pushDelete(table:TableName,id:string):Promise<void>{const {error}=await withNetworkTimeout(supabase.from(table).delete().eq("id",id));if(error)throw error;}

async function fetchAllRows(table: TableName): Promise<any[]> {
  const all: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await withNetworkTimeout<{ data: any[] | null; error: { message: string } | null }>((supabase.from(table) as any).select("*").order("id", { ascending: true }).range(offset, offset + 999));
    if (error) throw error;
    const page = (data ?? []) as any[];
    all.push(...page);
    if (page.length < 1000) break;
  }
  return all;
}
async function currentUserId():Promise<string|null>{try{const {data}=await supabase.auth.getSession();return data.session?.user?.id??null;}catch{return null;}}

// ---- Outbox helpers ----
export async function enqueue(table: TableName, op: "upsert" | "delete", id: string, payload?: unknown) {
  if (!isBrowser()) return;
  await db().outbox.put({ table, id, op, payload, ts: Date.now(), attempts: 0 });
}

export async function outboxCount(): Promise<number> {
  if (!isBrowser()) return 0;
  return db().outbox.count();
}

export async function flushOutbox(onProgress?: (done: number, total: number) => void): Promise<{ ok: number; failed: number }> {
  if (!isBrowser() || !navigator.onLine) return { ok: 0, failed: 0 };
  const now=Date.now();const allItems=await db().outbox.orderBy("ts").toArray();const items=allItems.filter(it=>now-(it.ts??0)>=Math.min(15*60_000,it.attempts?5_000*(2**Math.min(it.attempts-1,8)):0));
  let ok=0,failed=0;
  for(let i=0;i<items.length;i++){if(!navigator.onLine){failed+=items.length-i;break;}const it=items[i];
    try {
      if(it.op==="upsert"){const payload={...(it.payload as Record<string,unknown>)};if(it.table==="measurements"){payload.sync_state="synced";payload.synced_at=new Date().toISOString();}await pushUpsert(it.table,payload);if(it.table==="measurements")await db().measurements.update(it.id,{syncState:"synced",syncedAt:Date.now()});}else await pushDelete(it.table,it.id);
      await db().outbox.delete([it.table,it.id] as never);
      ok++;
    } catch (e) {
      failed++;
      await db().outbox.update([it.table, it.id] as never, {
        ts: Date.now(),
        attempts: (it.attempts ?? 0) + 1,
        lastError: (e as Error).message ?? String(e),
      });
    }
    onProgress?.(i + 1, items.length);
  }
  return { ok, failed };
}

// ---- File d'attente des fichiers importés hors ligne (contenu conservé en local) ----
export async function enqueueImportFile(blob: Blob, name: string, parcelleId: string | null): Promise<string> {
  const id = crypto.randomUUID();
  await db().importQueue.put({ id, name, parcelleId, blob, ts: Date.now() });
  return id;
}

export async function importQueueCount(): Promise<number> {
  if (!isBrowser()) return 0;
  return db().importQueue.count();
}

export async function flushImportQueue(): Promise<{ ok: number; failed: number }> {
  if (!isBrowser() || !navigator.onLine) return { ok: 0, failed: 0 };
  const items = await db().importQueue.toArray();
  let ok = 0, failed = 0;
  for (const it of items) {
    try {
      const userId = await currentUserId();
      const storagePath = `${userId ?? "anonymous"}/${Date.now()}-${it.name.replace(/[^\w.-]+/g, "_")}`;
      const up = await supabase.storage.from("imports").upload(storagePath, it.blob, { upsert: true });
      if (up.error) throw up.error;
      const ins = await supabase.from("imports").insert({
        parcelle_id: it.parcelleId || null,
        file_name: it.name,
        file_type: it.name.split(".").pop() ?? "",
        storage_path: storagePath,
        size_bytes: it.blob.size,
        status: "archived",
        created_by: userId,
      });
      if (ins.error) throw ins.error;
      await db().importQueue.delete(it.id);
      ok++;
    } catch { failed++; }
  }
  return { ok, failed };
}

// ---- Public API: write-through helpers used by code that wants cloud sync now.
// Existing code that writes directly to Dexie still works — call enqueueFromLocal
// to schedule the cloud push manually, or run migrateLocalToCloud once.
export async function syncEntity(table: TableName, id: string): Promise<void> {
  const userId = await currentUserId();
  const local = db();
  let payload: Record<string, unknown> | null = null;
  if (table === "sps") { const r = await local.sps.get(id); if (r) payload = mapSp(r, userId); }
  else if (table === "domaines") { const r = await local.domaines.get(id); if (r) payload = mapDomaine(r, userId); }
  else if (table === "parcelles") { const r = await local.parcelles.get(id); if (r) payload = mapParcelle(r, userId); }
  else if (table === "measurements") { const r = await local.measurements.get(id); if (r) payload = mapMeasurement(r, userId); }
  else if (table === "lots") { const r = await local.lots.get(id); if (r) payload = mapLot(r, userId); }
  else if (table === "morcellement_plans") { const r = await local.plans.get(id); if (r) payload = mapPlan(r, userId); }
  if (!payload) return;
  // Écrire d'abord dans la file durable : un changement de page ou une fermeture
  // immédiate ne peut plus interrompre l'envoi avant sa mise en attente.
  await enqueue(table, "upsert", id, payload);
  if(navigator.onLine){try{const outgoing={...payload};if(table==="measurements"){outgoing.sync_state="synced";outgoing.synced_at=new Date().toISOString();}await pushUpsert(table,outgoing);if(table==="measurements")await local.measurements.update(id,{syncState:"synced",syncedAt:Date.now()});await local.outbox.delete([table,id] as never);return;}catch(e){throw e;}}
}

// ---- Full migration from local IndexedDB to Supabase ----
export interface MigrationProgress {
  table: TableName | "done";
  done: number;
  total: number;
  ok: number;
  failed: number;
}

export async function migrateLocalToCloud(onProgress: (p: MigrationProgress) => void): Promise<{ ok: number; failed: number; perTable: Record<string, { ok: number; failed: number }> }> {
  const userId = await currentUserId();
  const local = db();
  const tables: Array<{
    name: TableName;
    rows: () => Promise<unknown[]>;
    map: (r: unknown) => Record<string, unknown>;
  }> = [
    { name: "sps", rows: () => local.sps.toArray(), map: (r) => mapSp(r as SP, userId) },
    { name: "domaines", rows: () => local.domaines.toArray(), map: (r) => mapDomaine(r as Domaine, userId) },
    { name: "parcelles", rows: () => local.parcelles.toArray(), map: (r) => mapParcelle(r as Parcelle, userId) },
    { name: "measurements", rows: () => local.measurements.toArray(), map: (r) => mapMeasurement(r as Measurement, userId) },
    { name: "morcellement_plans", rows: () => local.plans.toArray(), map: (r) => mapPlan(r as MorcPlan, userId) },
    { name: "lots", rows: () => local.lots.toArray(), map: (r) => mapLot(r as Lot, userId) },
  ];
  const perTable: Record<string, { ok: number; failed: number }> = {};
  let totalOk = 0, totalFailed = 0;
  for (const t of tables) {
    const rows = await t.rows();
    perTable[t.name] = { ok: 0, failed: 0 };
    for (let i = 0; i < rows.length; i++) {
      const payload = t.map(rows[i]);
      try {
        await pushUpsert(t.name, payload);
        perTable[t.name].ok++; totalOk++;
      } catch (e) {
        perTable[t.name].failed++; totalFailed++;
        await enqueue(t.name, "upsert", (payload.id as string), payload).catch(() => {});
        // store error for surfacing
        console.error(`[migrate] ${t.name} ${payload.id} →`, (e as Error).message);
      }
      onProgress({ table: t.name, done: i + 1, total: rows.length, ok: totalOk, failed: totalFailed });
    }
  }
  onProgress({ table: "done", done: totalOk + totalFailed, total: totalOk + totalFailed, ok: totalOk, failed: totalFailed });
  return { ok: totalOk, failed: totalFailed, perTable };
}

// ---- Lecture depuis Supabase → cache local IndexedDB (hors ligne) ----
function ts(v: string | null | undefined): number {
  return v ? new Date(v).getTime() : Date.now();
}

export interface PullResult { total: number; perTable: Record<string, number> }

export async function pullFromCloud(): Promise<PullResult> {
  if (!isBrowser()) return { total: 0, perTable: {} };
  const local = db();
  const perTable: Record<string, number> = {};
  let total = 0;

  const pending = await local.outbox.toArray();
  const pendingIds = (table: TableName) => new Set(pending.filter((o) => o.table === table).map((o) => o.id));

  async function reconcile<T extends { id: string }>(
    table: TableName,
    localRows: T[],
    cloudRows: T[],
    bulkDelete: (ids: string[]) => Promise<unknown>,
    bulkPut: (rows: T[]) => Promise<unknown>,
  ) {
    const cloudIds = new Set(cloudRows.map((row) => row.id));
    const protectedIds = pendingIds(table);
    const stale = localRows.filter((row) => !cloudIds.has(row.id) && !protectedIds.has(row.id)).map((row) => row.id);
    if (stale.length) await bulkDelete(stale);
    const safeCloudRows = cloudRows.filter((row) => !protectedIds.has(row.id));
    if (safeCloudRows.length) await bulkPut(safeCloudRows);
  }

  const spsData = await fetchAllRows("sps");
  if (spsData) {
    const rows: SP[] = spsData.map((r) => ({
      id: r.id, code: r.code, name: r.name,
      district: r.district ?? "", region: r.region ?? "", departement: r.departement ?? "",
      notes: r.notes ?? undefined, archivedAt: r.archived_at ? ts(r.archived_at) : null, createdAt: ts(r.created_at),
    }));
    await reconcile("sps", await local.sps.toArray(), rows, (ids) => local.sps.bulkDelete(ids), (items) => local.sps.bulkPut(items));
    perTable.sps = rows.length; total += rows.length;
  }

  const domData = await fetchAllRows("domaines");
  if (domData) {
    const rows: Domaine[] = domData.map((r) => ({
      id: r.id, code: r.code, name: r.name, spId: r.sp_id,
      description: r.description ?? undefined, notes: r.notes ?? undefined,
      archivedAt: r.archived_at ? ts(r.archived_at) : null, createdAt: ts(r.created_at),
    }));
    await reconcile("domaines", await local.domaines.toArray(), rows, (ids) => local.domaines.bulkDelete(ids), (items) => local.domaines.bulkPut(items));
    perTable.domaines = rows.length; total += rows.length;
  }

  const parcData = await fetchAllRows("parcelles");
  if (parcData) {
    const rows: Parcelle[] = parcData.map((r) => ({
      id: r.id, code: r.code, name: (r as { name?: string | null }).name ?? undefined,
      ownerName: r.owner_name ?? "", ownerPhone: r.owner_phone ?? undefined,
      domaineId: r.domaine_id, conventionDate: ts(r.convention_date),
      declaredArea: r.declared_area ?? undefined,
      conventionStatus: (r.convention_status ?? "EN_COURS") as Parcelle["conventionStatus"],
      ownerPhoto: r.owner_photo ?? undefined, groupPhoto: r.group_photo ?? undefined,
      parcellePhoto: r.parcelle_photo ?? undefined,
      notes: r.notes ?? undefined, archivedAt: r.archived_at ? ts(r.archived_at) : null, createdAt: ts(r.created_at),
    }));
    await reconcile("parcelles", await local.parcelles.toArray(), rows, (ids) => local.parcelles.bulkDelete(ids), (items) => local.parcelles.bulkPut(items));
    perTable.parcelles = rows.length; total += rows.length;
  }

  const mData = await fetchAllRows("measurements");
  if (mData) {
    const rows: Measurement[] = mData.map((r) => ({
      id: r.id, parcelleId: r.parcelle_id ?? undefined,
      createdBy: r.created_by ?? "", createdAt: ts(r.created_at),
      status: r.status as Measurement["status"],
      validatedBy: r.validated_by ?? undefined,
      validatedAt: r.validated_at ? ts(r.validated_at) : undefined,
      points: (r.points ?? []) as Measurement["points"],
      trace: (r.trace ?? []) as Measurement["trace"],
      areaM2: Number(r.area_m2 ?? 0), perimeterM: Number(r.perimeter_m ?? 0),
      unit: (r.unit ?? "ha") as Measurement["unit"],
      deviceProfile: (r.device_profile ?? undefined) as Measurement["deviceProfile"],
      qa: (r.qa ?? undefined) as Measurement["qa"],
      offlineCreated: Boolean(r.offline_created),
      syncState: (r.sync_state ?? "synced") as Measurement["syncState"],
      syncedAt: r.synced_at ? ts(r.synced_at) : undefined,
      notes: r.notes ?? undefined,
    }));
    await reconcile("measurements", await local.measurements.toArray(), rows, (ids) => local.measurements.bulkDelete(ids), (items) => local.measurements.bulkPut(items));
    perTable.measurements = rows.length; total += rows.length;
  }

  const planData = await fetchAllRows("morcellement_plans");
  if (planData) {
    const rows: MorcPlan[] = planData.map((r) => ({
      id: r.id, parcelleId: r.parcelle_id, measurementId: r.measurement_id ?? null,
      reference: r.reference ?? undefined,
      config: r.config, score: r.score,
      targetM2: Number(r.target_m2 ?? 0), totalM2: Number(r.total_m2 ?? 0),
      conforme: Boolean(r.conforme), status: (r.status ?? "draft") as MorcPlan["status"],
      notes: r.notes ?? undefined, createdAt: ts(r.created_at),
    }));
    await reconcile("morcellement_plans", await local.plans.toArray(), rows, (ids) => local.plans.bulkDelete(ids), (items) => local.plans.bulkPut(items));
    perTable.plans = rows.length; total += rows.length;
  }

  const lotData = await fetchAllRows("lots");
  if (lotData) {
    const rows: Lot[] = lotData.map((r) => ({
      id: r.id, parcelleId: r.parcelle_id, measurementId: r.measurement_id ?? "",
      code: r.code, polygon: (r.polygon ?? []) as Lot["polygon"],
      bornes: (r.bornes ?? []) as Lot["bornes"],
      areaM2: Number(r.area_m2 ?? 0), isReserve: r.is_reserve ?? false,
      assigneeName: r.assignee_name ?? undefined,
      assigneeOwnerId: r.assignee_owner_id ?? undefined,
      assignedAt: r.assigned_at ? ts(r.assigned_at) : undefined,
      planId: r.plan_id ?? null,
      part: (r.part ?? "proprietaire") as Lot["part"],
      kind: (r.kind ?? "lot") as Lot["kind"],
      label: r.label ?? undefined,
      targetAreaM2: r.target_area_m2 != null ? Number(r.target_area_m2) : undefined,
      assigneeContact: r.assignee_contact ?? undefined,
      assigneeAccount: r.assignee_account ?? undefined,
    }));
    await reconcile("lots", await local.lots.toArray(), rows, (ids) => local.lots.bulkDelete(ids), (items) => local.lots.bulkPut(items));
    perTable.lots = rows.length; total += rows.length;
  }

  return { total, perTable };
}

// ---- Suppression synchronisée (locale déjà faite par l'appelant) ----
export async function syncDelete(table: TableName, id: string): Promise<void> {
  if (!isBrowser()) return;
  await enqueue(table, "delete", id);
  if (navigator.onLine) {
    try {
      await pushDelete(table, id);
      await db().outbox.delete([table, id] as never);
      return;
    } catch { return; }
  }
}

/** Push best-effort, jamais bloquant pour l'UI (échec ⇒ file d'attente). */
export function syncNow(table: TableName, id: string): void {
  void syncEntity(table, id).catch(() => {});
}
export function syncRemoved(table: TableName, id: string): void {
  void syncDelete(table, id).catch(() => {});
}

/** Vide toutes les files d'attente puis rafraîchit le cache local depuis le cloud. */
export async function syncAll(): Promise<{ flushed: number; failed: number; pulled: number; imports: number }> {
  if (!isBrowser() || !navigator.onLine) return { flushed: 0, failed: 0, pulled: 0, imports: 0 };
  const { ok, failed } = await flushOutbox();
  const imp = await flushImportQueue();
  const pulled = (await pullFromCloud()).total;
  return { flushed: ok, failed, pulled, imports: imp.ok };
}

/** Migration unique par appareil : pousse l'historique local encore absent du cloud. */
const META_MIGRATED = "sync.migratedAt";
export async function ensureInitialMigration(): Promise<void> {
  if (!isBrowser() || !navigator.onLine) return;
  const local = db();
  const flag = await local.meta.get(META_MIGRATED);
  if (flag?.value) return;
  const counts = await Promise.all([
    local.sps.count(), local.domaines.count(), local.parcelles.count(),
    local.measurements.count(), local.lots.count(), local.plans.count(),
  ]);
  if (counts.reduce((a, b) => a + b, 0) === 0) {
    await local.meta.put({ key: META_MIGRATED, value: Date.now() });
    return;
  }
  try {
    await migrateLocalToCloud(() => {});
    await local.meta.put({ key: META_MIGRATED, value: Date.now() });
  } catch { /* réessai au prochain démarrage */ }
}

// ---- Auto-flush : reconnexion, retour au premier plan, périodique ----
let _initialized=false,_running=false;let _retryTimer:ReturnType<typeof setTimeout>|undefined;
export function initSync(){if(!isBrowser()||_initialized)return;_initialized=true;
 const scheduleRetry=(delay=15_000)=>{if(_retryTimer)clearTimeout(_retryTimer);_retryTimer=setTimeout(run,delay);};
 const run=()=>{if(_running||!navigator.onLine)return;_running=true;void syncAll().then(result=>{if(result.failed>0)scheduleRetry();else if(result.pulled===0&&result.flushed===0)scheduleRetry(60_000);}).catch(e=>{console.warn("[sync] opérations conservées en attente",e);scheduleRetry();}).finally(()=>{_running=false;});};
 window.addEventListener("online",()=>{if(_retryTimer)clearTimeout(_retryTimer);run();});window.addEventListener("offline",()=>{if(_retryTimer)clearTimeout(_retryTimer);});window.addEventListener("focus",run);document.addEventListener("visibilitychange",()=>{if(!document.hidden)run();});(navigator as Navigator&{connection?:EventTarget}).connection?.addEventListener("change",run);setInterval(run,30_000);if(navigator.onLine)setTimeout(()=>{void ensureInitialMigration().catch(()=>{}).finally(run);},1500);
}

