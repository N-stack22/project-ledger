import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});
