import { neon } from "@neondatabase/serverless";

export function getNeonSql() {
  const connectionString =
    process.env.NEON_DATABASE_URL_DEV ?? process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    throw new Error("NEON_DATABASE_URL_DEV or NEON_DATABASE_URL is required.");
  }
  return neon(connectionString);
}
