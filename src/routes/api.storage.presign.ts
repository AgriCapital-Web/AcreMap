import { createFileRoute } from "@tanstack/react-router";
import { Buffer } from "node:buffer";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@neondatabase/neon-js";
import { getNeonStorageClient } from "@/integrations/neon/storage.server";

const BUCKETS = new Set(["imports", "photos"]);
const MAX_BYTES = 30 * 1024 * 1024;

export const Route = createFileRoute("/api/storage/presign")({
  server: { handlers: {
    POST: async ({ request }) => {
      const auth = await authenticate(request);
      if (!auth) return json({ error: "unauthorized" }, 401);
      let body: any;
      try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
      const bucket = String(body?.bucket ?? "");
      const fileName = String(body?.fileName ?? "");
      const contentType = String(body?.contentType ?? "application/octet-stream");
      const size = Number(body?.size ?? 0);
      if (!BUCKETS.has(bucket) || !fileName || !Number.isFinite(size) || size < 1 || size > MAX_BYTES) {
        return json({ error: "invalid_upload_request" }, 400);
      }
      if (bucket === "photos" && !["image/jpeg","image/png","image/webp"].includes(contentType)) {
        return json({ error: "unsupported_photo_type" }, 415);
      }
      const safeName = fileName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
      const key = `${auth.userId}/${crypto.randomUUID()}-${safeName}`;
      const s3 = getNeonStorageClient();
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn: 300, signableHeaders: new Set(["content-type"]) },
      );
      return json({ url, bucket, key, headers: { "Content-Type": contentType } });
    },
    DELETE: async ({ request }) => {
      const auth = await authenticate(request);
      if (!auth) return json({ error: "unauthorized" }, 401);
      let body: any;
      try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
      const bucket = String(body?.bucket ?? "");
      const key = String(body?.key ?? "");
      if (!BUCKETS.has(bucket) || (!auth.isAdmin && !key.startsWith(`${auth.userId}/`))) {
        return json({ error: "forbidden" }, 403);
      }
      await getNeonStorageClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return json({ ok: true });
    },
    GET: async ({ request }) => {
      const auth = await authenticate(request);
      if (!auth) return json({ error: "unauthorized" }, 401);
      const params = new URL(request.url).searchParams;
      const bucket = params.get("bucket") ?? "";
      const key = params.get("key") ?? "";
      if (!BUCKETS.has(bucket) || (!auth.isAdmin && !key.startsWith(`${auth.userId}/`))) {
        return json({ error: "forbidden" }, 403);
      }
      const url = await getSignedUrl(
        getNeonStorageClient(),
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: 300 },
      );
      return json({ url });
    },
  } },
});

async function authenticate(request: Request): Promise<{ userId: string; isAdmin: boolean } | null> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { return null; }
  const userId = typeof claims.sub === "string" ? claims.sub : "";
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  if (!userId || (exp > 0 && exp <= Math.floor(Date.now() / 1000))) return null;
  const dataApiUrl = process.env.VITE_NEON_DATA_API_URL_DEV ?? process.env.VITE_NEON_DATA_API_URL;
  if (!dataApiUrl) return null;
  const db = createClient({ dataApi: { url: dataApiUrl, getToken: async () => token } });
  const { data, error } = await db.from("profiles").select("id,disabled").eq("id", userId).maybeSingle();
  if (error || !data || data.disabled) return null;
  const { data: roles, error: roleError } = await db.from("user_roles").select("role").eq("user_id", userId);
  if (roleError || !roles?.length) return null;
  return { userId, isAdmin: roles.some((r: any) => r.role === "admin") };
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
