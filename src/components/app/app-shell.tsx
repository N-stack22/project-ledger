import { Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  BarChart3,
  ClipboardCheck,
  FileSpreadsheet,
  FileStack,
  FileText,
  FolderKanban,
  Gauge,
  HardHat,
  Settings,
  ShieldCheck,
  Users,
  WalletCards,
  TrendingUp,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { roleLabels } from "@/lib/business";
import { WorkspaceProvider } from "@/components/app/workspace-provider";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { NotificationsBell } from "@/components/app/notifications-bell";
import { Home } from "lucide-react";

const menuGroups = [
  {
    label: "Operación",
    items: [
      { title: "Dashboard", to: "/app/dashboard", icon: Gauge },
      { title: "Proyectos", to: "/app/projects", icon: FolderKanban },
      { title: "Presupuestos", to: "/app/budgets", icon: FileSpreadsheet },
      { title: "Memoria valorizada e Informe Técnico", to: "/app/expediente", icon: FileStack },
      { title: "Bandeja de Memorias", to: "/app/memorias", icon: FileStack },
      { title: "Metrados", to: "/app/metrados", icon: HardHat },
      { title: "Valorizaciones", to: "/app/valuations", icon: WalletCards },
      { title: "Reajustes", to: "/app/reajustes", icon: TrendingUp },
      { title: "Aprobaciones", to: "/app/approvals", icon: ClipboardCheck },
    ],
  },
  {
    label: "Control",
    items: [
      { title: "Reportes", to: "/app/reports", icon: BarChart3 },
      { title: "Liquidación", to: "/app/liquidation", icon: ShieldCheck },
      { title: "Documentos", to: "/app/documents", icon: FileText },
      { title: "Usuarios", to: "/app/users", icon: Users },
      { title: "Configuración", to: "/app/settings", icon: Settings },
    ],
  },
] as const;

function AppSidebar() {
  const location = useLocation();
  const { profile, roles } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-3 border-b border-sidebar-border px-3 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <HardHat className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">JJ&PP Ingenieros</p>
              <p className="truncate text-xs text-sidebar-foreground/70">Gestión de metrados y valorizaciones</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {menuGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = location.pathname === item.to;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.to}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="px-3 py-4">
        {!collapsed && (
          <div className="space-y-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{profile?.full_name || "Usuario"}</p>
            <div className="flex flex-wrap gap-1">
              {roles.map((role) => (
                <Badge key={role} variant="outline" className="border-sidebar-border bg-sidebar-accent text-[11px] text-sidebar-accent-foreground">
                  {roleLabels[role]}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function AppTopbar() {
  const location = useLocation();
  const { signOut, profile } = useAuth();
  const segments = location.pathname.split("/").filter(Boolean).slice(1);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <SidebarTrigger className="h-9 w-9 rounded-md border border-border" />
          <div className="min-w-0">
            <nav className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Inicio</span>
              {segments.map((segment) => (
                <span key={segment} className="flex items-center gap-2">
                  <span>/</span>
                  <span className="capitalize">{segment.replace(/-/g, " ")}</span>
                </span>
              ))}
            </nav>
            <p className="truncate text-sm font-medium text-foreground">{profile?.job_title || "Plataforma de control de obra"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <Home className="mr-2 h-4 w-4" />
              Volver a inicio
            </Link>
          </Button>
          <NotificationsBell />
          <ThemeToggle />
          <Button variant="outline" onClick={() => void signOut()}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    </header>
  );
}

export function AppShell() {
  return (
    <WorkspaceProvider>
      <SidebarProvider defaultOpen>
        <AppSidebar />
        <SidebarInset className="min-w-0 overflow-x-hidden">
          <AppTopbar />
          <div className="min-w-0 flex-1 px-4 py-6 md:px-6">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceProvider>
  );
}
