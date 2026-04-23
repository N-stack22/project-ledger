import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AuthGuard } from "@/components/app/auth-guard";
import { AppShell } from "@/components/app/app-shell";

function AppLayout() {
  return (
    <AuthGuard>
      <AppShell />
    </AuthGuard>
  );
}

export const Route = createFileRoute("/app")({
  component: AppLayout,
});
