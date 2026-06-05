import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type {
  BudgetImportRow,
  BudgetItemRow,
  LiquidationRow,
  MemoriaRow,
  MetradoEntryRow,
  ProfileRow,
  ProjectMemberRow,
  ProjectRow,
  ReajusteRow,
  UserGlobalRoleRow,
  UserRoleRow,
  ValuationLineRow,
  ValuationRow,
  WorkflowCommentRow,
} from "@/lib/domain";
import { useAuth } from "@/lib/auth";

interface WorkspaceContextValue {
  loading: boolean;
  refreshing: boolean;
  projects: ProjectRow[];
  budgetImports: BudgetImportRow[];
  budgetItems: BudgetItemRow[];
  metrados: MetradoEntryRow[];
  memorias: MemoriaRow[];
  valuations: ValuationRow[];
  valuationLines: ValuationLineRow[];
  liquidations: LiquidationRow[];
  workflowComments: WorkflowCommentRow[];
  profiles: ProfileRow[];
  userRoles: UserRoleRow[];
  projectMembers: ProjectMemberRow[];
  userGlobalRoles: UserGlobalRoleRow[];
  reajustes: ReajusteRow[];
  auditLogs: Array<{ id: string; action: string; created_at: string; entity_type: string; actor_user_id: string | null }>;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [budgetImports, setBudgetImports] = useState<BudgetImportRow[]>([]);
  const [budgetItems, setBudgetItems] = useState<BudgetItemRow[]>([]);
  const [metrados, setMetrados] = useState<MetradoEntryRow[]>([]);
  const [memorias, setMemorias] = useState<MemoriaRow[]>([]);
  const [valuations, setValuations] = useState<ValuationRow[]>([]);
  const [valuationLines, setValuationLines] = useState<ValuationLineRow[]>([]);
  const [liquidations, setLiquidations] = useState<LiquidationRow[]>([]);
  const [workflowComments, setWorkflowComments] = useState<WorkflowCommentRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [userRoles, setUserRoles] = useState<UserRoleRow[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMemberRow[]>([]);
  const [userGlobalRoles, setUserGlobalRoles] = useState<UserGlobalRoleRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; action: string; created_at: string; entity_type: string; actor_user_id: string | null }>>([]);

  const refresh = async () => {
    if (!isAuthenticated || !user) {
      setLoading(false);
      return;
    }

    setRefreshing(true);
    const projectQuery = supabase.from("projects").select("*").order("created_at", { ascending: false });
    const importsQuery = supabase.from("budget_imports").select("*").order("created_at", { ascending: false });
    const itemsQuery = supabase.from("budget_items").select("*").order("sort_order", { ascending: true });
    const metradosQuery = supabase.from("metrado_entries").select("*").order("entry_date", { ascending: false });
    const memoriasQuery = supabase.from("memoria_valorizada").select("*").order("period_month", { ascending: false });
    const valuationsQuery = supabase.from("valuations").select("*").order("period_month", { ascending: false });
    const valuationLinesQuery = supabase.from("valuation_lines").select("*");
    const liquidationsQuery = supabase.from("liquidations").select("*").order("created_at", { ascending: false });
    const commentsQuery = supabase.from("workflow_comments").select("*").order("created_at", { ascending: false });
    const auditQuery = supabase.from("audit_logs").select("id,action,created_at,entity_type,actor_user_id").order("created_at", { ascending: false }).limit(20);
    const projectMembersQuery = supabase.from("project_members").select("*");
    const userGlobalRolesQuery = supabase.from("user_global_roles").select("*").eq("user_id", user.id);

    const profileQuery = isAdmin
      ? supabase.from("profiles").select("*").order("created_at", { ascending: false })
      : supabase.from("profiles").select("*").eq("user_id", user.id);
    const rolesQuery = isAdmin
      ? supabase.from("user_roles").select("*").order("created_at", { ascending: false })
      : supabase.from("user_roles").select("*").eq("user_id", user.id);

    const [
      projectsResult,
      importsResult,
      itemsResult,
      metradosResult,
      memoriasResult,
      valuationsResult,
      valuationLinesResult,
      liquidationsResult,
      commentsResult,
      profilesResult,
      rolesResult,
      auditResult,
      projectMembersResult,
      userGlobalRolesResult,
    ] = await Promise.all([
      projectQuery,
      importsQuery,
      itemsQuery,
      metradosQuery,
      memoriasQuery,
      valuationsQuery,
      valuationLinesQuery,
      liquidationsQuery,
      commentsQuery,
      profileQuery,
      rolesQuery,
      auditQuery,
      projectMembersQuery,
      userGlobalRolesQuery,
    ]);

    setProjects(projectsResult.data ?? []);
    setBudgetImports(importsResult.data ?? []);
    setBudgetItems(itemsResult.data ?? []);
    setMetrados(metradosResult.data ?? []);
    setMemorias(memoriasResult.data ?? []);
    setValuations(valuationsResult.data ?? []);
    setValuationLines(valuationLinesResult.data ?? []);
    setLiquidations(liquidationsResult.data ?? []);
    setWorkflowComments(commentsResult.data ?? []);
    setProfiles(profilesResult.data ?? []);
    setUserRoles(rolesResult.data ?? []);
    setAuditLogs(auditResult.data ?? []);
    setProjectMembers(projectMembersResult.data ?? []);
    setUserGlobalRoles(userGlobalRolesResult.data ?? []);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    void refresh();
  }, [isAuthenticated, user?.id, isAdmin]);

  const value = useMemo(
    () => ({
      loading,
      refreshing,
      projects,
      budgetImports,
      budgetItems,
      metrados,
      memorias,
      valuations,
      valuationLines,
      liquidations,
      workflowComments,
      profiles,
      userRoles,
      projectMembers,
      userGlobalRoles,
      auditLogs,
      refresh,
    }),
    [
      auditLogs,
      budgetImports,
      budgetItems,
      liquidations,
      loading,
      memorias,
      metrados,
      profiles,
      projects,
      projectMembers,
      refreshing,
      userGlobalRoles,
      userRoles,
      valuationLines,
      valuations,
      workflowComments,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return context;
}
