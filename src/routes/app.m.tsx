import { createFileRoute } from "@tanstack/react-router";
import { MorcellementPage } from "./app.morcellement";

/** Raccourci de la station de morcellement intelligent : /app/m */
export const Route = createFileRoute("/app/m")({
  component: MorcellementPage,
  head: () => ({ meta: [{ title: "Morcellement intelligent — AcreMap" }] }),
});
