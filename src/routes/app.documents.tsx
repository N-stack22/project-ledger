import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/documents")({
  component: DocumentsPage,
});
