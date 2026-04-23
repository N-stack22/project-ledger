import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "@/components/app/workspace-pages";

export const Route = createFileRoute("/app/users")({
  component: UsersPage,
});
