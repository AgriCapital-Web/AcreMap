import { createFileRoute } from "@tanstack/react-router";
import { ParcDetail } from "./app.parcelles.$id";

/** URL courte de consultation d'une parcelle : /p/{identifiant}. */
export const Route = createFileRoute("/p/$id")({
  component: ParcDetail,
  head: () => ({ meta: [{ title: "Parcelle — AcreMap" }] }),
});
