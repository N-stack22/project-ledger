import { createFileRoute } from "@tanstack/react-router";
import { MemoriasPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/memorias")({
  component: MemoriasPage,
});
