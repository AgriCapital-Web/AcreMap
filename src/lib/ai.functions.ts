import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AiMessage { role: "user" | "assistant"; content: string }
const SYSTEM_PROMPT = "Tu es l'assistant technique d'AcreMap (AgriCapital, Côte d'Ivoire) : levés GPS, morcellement, réserves, voies, exports SIG et plans PDF. Réponds en français, de façon concise et opérationnelle.";

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { messages: AiMessage[] }) => {
    if (!Array.isArray(input?.messages) || input.messages.length === 0) throw new Error("messages requis");
    const messages = input.messages.slice(-20).map((message) => {
      if (!message || (message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") throw new Error("Message IA invalide.");
      const content = message.content.trim();
      if (!content || content.length > 8_000) throw new Error("Chaque message doit contenir entre 1 et 8 000 caractères.");
      return { role: message.role, content };
    });
    return { messages };
  })
  .handler(async ({ data }) => {
    const key = process.env["AI_API_KEY"];
    const endpoint = (process.env["AI_BASE_URL"] ?? "https://api.openai.com/v1/chat/completions").trim();
    const model = (process.env["AI_MODEL"] ?? "gpt-4.1-mini").trim();
    if (!key) throw new Error("Assistant IA non configuré : ajoutez AI_API_KEY dans les variables d'environnement serveur.");
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error("AI_BASE_URL doit être une URL valide."); }
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("AI_BASE_URL doit utiliser HTTPS.");
    const res = await fetch(url.toString(), {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM_PROMPT }, ...data.messages] }),
    });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "La clé IA est refusée par le fournisseur."
      : res.status === 429 ? "Limite d'utilisation IA atteinte. Réessayez plus tard." : `Le fournisseur IA a répondu avec le statut ${res.status}.`);
    const json = (await res.json()) as { choices?: { message?: { content?: string | { text?: string }[] } }[] };
    const raw = json.choices?.[0]?.message?.content;
    const content = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((part) => part.text ?? "").join("") : "";
    if (!content.trim()) throw new Error("Le fournisseur IA n'a retourné aucune réponse.");
    return { content };
  });

export const getIntegrationsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ ai: Boolean(process.env["AI_API_KEY"]), googleMaps: Boolean(process.env["GOOGLE_MAPS_API_KEY"]) }));

export const getGoogleMapsKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ key: process.env["GOOGLE_MAPS_API_KEY"] ?? null }));
