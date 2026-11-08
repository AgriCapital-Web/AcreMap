import { supabase } from "@/integrations/neon/client";

export async function uploadNeonObject(
  bucket: "imports" | "photos",
  fileName: string,
  blob: Blob,
): Promise<{ bucket: string; key: string }> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error("Une session AcreMap est requise pour téléverser ce fichier.");
  const contentType = blob.type || "application/octet-stream";
  const response = await fetch("/api/storage/presign", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ bucket, fileName, contentType, size: blob.size }),
  });
  if (!response.ok) throw new Error("Impossible de préparer le téléversement Neon.");
  const signed = await response.json() as { url: string; bucket: string; key: string; headers: Record<string, string> };
  const upload = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
  if (!upload.ok) throw new Error("Le téléversement vers Neon Object Storage a échoué.");
  return { bucket: signed.bucket, key: signed.key };
}

export async function getNeonObjectUrl(bucket: "imports" | "photos", key: string): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error("Une session AcreMap est requise pour consulter ce fichier.");
  const params = new URLSearchParams({ bucket, key });
  const response = await fetch(`/api/storage/presign?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Impossible de préparer le téléchargement Neon.");
  const result = await response.json() as { url: string };
  return result.url;
}
