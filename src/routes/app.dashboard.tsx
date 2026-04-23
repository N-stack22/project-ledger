import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/dashboard")({
  component: DashboardPage,
});
