import { readdir, writeFile, access } from "node:fs/promises";
import { join, relative, extname, sep } from "node:path";

const candidates = [
  join(process.cwd(), ".vercel", "output", "static"),
  join(process.cwd(), ".output", "public"),
];
let root = candidates[0];
for (const candidate of candidates) {
  try { await access(candidate); root = candidate; break; } catch {}
}
const extensions = new Set([".js", ".mjs", ".css", ".woff", ".woff2", ".ttf", ".otf", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".json", ".webmanifest"]);
const files = [];
async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase()) && entry.name !== "offline-assets.json" && entry.name !== "sw.js") {
      files.push("/" + relative(root, path).split(sep).join("/"));
    }
  }
}
await walk(root);
files.sort();
await writeFile(join(root, "offline-assets.json"), JSON.stringify(files));
console.log(`[offline] ${files.length} client assets listed from ${root} for persistent offline cache`);
