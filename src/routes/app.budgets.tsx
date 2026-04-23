import { createFileRoute } from "@tanstack/react-router";
import { BudgetsPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/budgets")({
  component: BudgetsPage,
});
