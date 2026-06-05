import type { Database } from "@/integrations/supabase/types";
import type {
  DocumentStatus,
  LiquidationStatus,
  ValuationStatus,
  WorkflowAction,
  WorkflowEntity,
} from "@/lib/domain";

export type ProjectRole = Database["public"]["Enums"]["project_role"];

export type WorkflowKind = WorkflowEntity; // "memoria_valorizada" | "valuation" | "liquidation"

export type WorkflowStatus = DocumentStatus | ValuationStatus | LiquidationStatus;

export type WorkflowTransition = {
  action: WorkflowAction;
  label: string;
  fromStatuses: WorkflowStatus[];
  toStatus: WorkflowStatus;
  allowedRoles: ProjectRole[];
  /** When true, the user must enter a comment before the action runs. */
  requiresComment?: boolean;
  variant?: "default" | "outline" | "destructive";
};

const RESIDENTE: ProjectRole[] = ["admin_proyecto", "residente_obra"];
const SUPERVISOR: ProjectRole[] = ["admin_proyecto", "supervisor_inspector"];
const ENTIDAD: ProjectRole[] = ["admin_proyecto", "entidad_publica", "representante_legal"];

const memoriaTransitions: WorkflowTransition[] = [
  { action: "submitted", label: "Enviar a revisión", fromStatuses: ["draft", "rejected"], toStatus: "in_review", allowedRoles: RESIDENTE },
  { action: "approved", label: "Aprobar", fromStatuses: ["in_review"], toStatus: "approved", allowedRoles: SUPERVISOR },
  { action: "rejected", label: "Observar", fromStatuses: ["in_review"], toStatus: "rejected", allowedRoles: SUPERVISOR, requiresComment: true, variant: "destructive" },
];

const valuationTransitions: WorkflowTransition[] = [
  { action: "reviewed", label: "Marcar revisada", fromStatuses: ["pending", "rejected"], toStatus: "reviewed", allowedRoles: RESIDENTE },
  { action: "approved", label: "Aprobar", fromStatuses: ["reviewed"], toStatus: "approved", allowedRoles: [...SUPERVISOR, "entidad_publica"] },
  { action: "rejected", label: "Rechazar", fromStatuses: ["pending", "reviewed"], toStatus: "rejected", allowedRoles: [...SUPERVISOR, "entidad_publica"], requiresComment: true, variant: "destructive" },
];

const liquidationTransitions: WorkflowTransition[] = [
  { action: "submitted", label: "Marcar generada", fromStatuses: ["draft"], toStatus: "generated", allowedRoles: RESIDENTE },
  { action: "approved", label: "Aprobar", fromStatuses: ["generated"], toStatus: "approved", allowedRoles: ENTIDAD },
  { action: "rejected", label: "Devolver", fromStatuses: ["generated"], toStatus: "draft", allowedRoles: ENTIDAD, requiresComment: true, variant: "destructive" },
];

export function getWorkflowTransitions(kind: WorkflowKind): WorkflowTransition[] {
  switch (kind) {
    case "memoria_valorizada":
      return memoriaTransitions;
    case "valuation":
      return valuationTransitions;
    case "liquidation":
      return liquidationTransitions;
  }
}

export function getAvailableTransitions(params: {
  kind: WorkflowKind;
  status: WorkflowStatus;
  roles: ProjectRole[];
  isGlobalAdmin?: boolean;
}): WorkflowTransition[] {
  const { kind, status, roles, isGlobalAdmin } = params;
  return getWorkflowTransitions(kind).filter((t) => {
    if (!t.fromStatuses.includes(status)) return false;
    if (isGlobalAdmin) return true;
    return roles.some((r) => t.allowedRoles.includes(r));
  });
}

export function canUserPerform(
  transition: WorkflowTransition,
  roles: ProjectRole[],
  isGlobalAdmin = false,
): boolean {
  if (isGlobalAdmin) return true;
  return roles.some((r) => transition.allowedRoles.includes(r));
}

export const workflowEntityLabels: Record<WorkflowKind, string> = {
  memoria_valorizada: "Memoria",
  valuation: "Valorización",
  liquidation: "Liquidación",
};
