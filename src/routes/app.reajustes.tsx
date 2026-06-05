import { createFileRoute } from "@tanstack/react-router";
import { ReajustesPage } from "@/components/app/reajustes-page";

export const Route = createFileRoute("/app/reajustes")({
  component: ReajustesPage,
});
