import { createFileRoute } from "@tanstack/react-router";
import { ApprovalsPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/approvals")({
  component: ApprovalsPage,
});
