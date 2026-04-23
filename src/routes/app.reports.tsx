import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});
