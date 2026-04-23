import { createFileRoute } from "@tanstack/react-router";
import { MetradosPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/metrados")({
  component: MetradosPage,
});
