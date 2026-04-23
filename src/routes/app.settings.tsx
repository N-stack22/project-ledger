import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});
