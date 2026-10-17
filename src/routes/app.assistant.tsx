import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { answerAcreMapQuestion } from "@/lib/assistant-local";

type Message = { role: "user" | "assistant"; content: string };

export const Route = createFileRoute("/app/assistant")({
  component: AssistantPage,
  head: () => ({ meta: [
    { title: "Aide technique — AcreMap" },
    { name: "description", content: "Aide locale pour les levés GPS, le morcellement, les superficies, les exports et le CRM." },
    { property: "og:title", content: "Aide technique — AcreMap" },
    { property: "og:description", content: "Procédures intégrées pour les levés, morcellements et exports AcreMap." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
});

function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  function send() {
    const question = input.trim();
    if (!question) return;
    setInput("");
    setMessages((current) => [...current,
      { role: "user", content: question },
      { role: "assistant", content: answerAcreMapQuestion(question) },
    ]);
  }
  const suggestions = ["Comment gérer le reliquat ?", "Comment vérifier un périmètre GPS ?", "Comment calculer les hectares ?", "Quels exports sont disponibles ?", "Comment synchroniser un propriétaire CRM ?"];
  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Aide technique intégrée</h1>
        <p className="text-sm text-muted-foreground mt-1">Procédures locales pour le GPS, le morcellement, les superficies, les voies, les exports et le CRM.</p>
        <div className="mt-3 inline-flex rounded-md border bg-muted px-2.5 py-1 text-xs">Moteur interne embarqué · sans IA externe · sans crédits</div>
      </header>
      <div className="rounded-xl border bg-card p-3 space-y-3 min-h-[240px]">
        {messages.length === 0 && <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Choisissez un sujet ou écrivez votre question.</p>
          <div className="flex flex-wrap gap-2">{suggestions.map((question) =>
            <button key={question} type="button" onClick={() => setInput(question)} className="rounded-lg border px-3 py-2 text-left text-xs hover:bg-muted">{question}</button>
          )}</div>
        </div>}
        {messages.map((message, index) => <div key={index} className={message.role === "user" ? "text-right" : ""}>
          <div className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{message.content}</div>
        </div>)}
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }}
          placeholder="Ex. : comment gérer le reliquat après morcellement ?" className="flex-1 h-11 px-3 rounded-lg border bg-card text-sm" />
        <button type="button" onClick={send} disabled={!input.trim()} className="h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">Envoyer</button>
      </div>
    </div>
  );
}
