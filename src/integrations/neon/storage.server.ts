import { S3Client } from "@aws-sdk/client-s3";

function storageEnv(name: string) {
  const dev = process.env[`${name}_DEV`];
  return dev || process.env[name];
}

export function getNeonStorageClient() {
  const accessKeyId = storageEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = storageEnv("AWS_SECRET_ACCESS_KEY");
  const endpoint = storageEnv("AWS_ENDPOINT_URL_S3");
  const region = storageEnv("AWS_REGION");
  if (!accessKeyId || !secretAccessKey || !endpoint || !region) {
    throw new Error("Neon Object Storage credentials are not configured.");
  }
  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}
