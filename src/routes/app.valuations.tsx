import { createFileRoute } from "@tanstack/react-router";
import { ValuationsPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/valuations")({
  component: ValuationsPage,
});
