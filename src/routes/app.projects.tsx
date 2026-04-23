import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/projects")({
  component: ProjectsPage,
});
