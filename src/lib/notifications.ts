// Helper to insert notifications for project members with specific roles.
// Used by the approval workflow to alert the next reviewer(s).

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type ProjectRole = Database["public"]["Enums"]["project_role"];

export type NotificationKind =
  | "workflow_pending"
  | "workflow_approved"
  | "workflow_rejected"
  | "workflow_commented"
  | "info";

export interface NotifyInput {
  projectId: string;
  roles: ProjectRole[];
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  actorUserId: string;
  /** If true, also notify the actor (default false). */
  includeActor?: boolean;
}

/** Insert one notification per member of `projectId` whose project_role ∈ roles. */
export async function notifyProjectRoles(input: NotifyInput): Promise<void> {
  const { data: members, error } = await supabase
    .from("project_members")
    .select("user_id, project_role")
    .eq("project_id", input.projectId)
    .in("project_role", input.roles);

  if (error || !members) return;

  const recipients = Array.from(
    new Set(
      members
        .map((m) => m.user_id)
        .filter((uid) => input.includeActor || uid !== input.actorUserId),
    ),
  );

  if (recipients.length === 0) return;

  const rows = recipients.map((uid) => ({
    user_id: uid,
    project_id: input.projectId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    created_by: input.actorUserId,
  }));

  await supabase.from("notifications").insert(rows);
}
