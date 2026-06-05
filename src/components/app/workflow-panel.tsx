import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  canUserPerform,
  getAvailableTransitions,
  workflowEntityLabels,
  type WorkflowKind,
  type WorkflowStatus,
  type WorkflowTransition,
} from "@/lib/workflow";
import { useWorkspace } from "@/components/app/workspace-provider";

const tableByKind: Record<WorkflowKind, "memoria_valorizada" | "valuations" | "liquidations"> = {
  memoria_valorizada: "memoria_valorizada",
  valuation: "valuations",
  liquidation: "liquidations",
};

interface WorkflowPanelProps {
  kind: WorkflowKind;
  projectId: string;
  entityId: string;
  status: WorkflowStatus;
  onChanged?: () => void | Promise<void>;
}

export function WorkflowPanel({ kind, projectId, entityId, status, onChanged }: WorkflowPanelProps) {
  const { user } = useAuth();
  const { projectMembers, userGlobalRoles, workflowComments, profiles, refresh } = useWorkspace();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const myRoles = useMemo(
    () =>
      projectMembers
        .filter((m) => m.project_id === projectId && m.user_id === user?.id)
        .map((m) => m.project_role),
    [projectMembers, projectId, user?.id],
  );

  const isGlobalAdmin = useMemo(
    () => userGlobalRoles.some((r) => r.role === "super_admin" || r.role === "admin_empresa"),
    [userGlobalRoles],
  );

  const availableTransitions = useMemo(
    () => getAvailableTransitions({ kind, status, roles: myRoles, isGlobalAdmin }),
    [kind, status, myRoles, isGlobalAdmin],
  );

  const comments = useMemo(
    () =>
      workflowComments
        .filter((c) => c.entity_type === kind && c.entity_id === entityId)
        .slice(0, 25),
    [workflowComments, kind, entityId],
  );

  const profileName = (userId: string | null) => {
    if (!userId) return "Sistema";
    return profiles.find((p) => p.user_id === userId)?.full_name || "Usuario";
  };

  const performTransition = async (transition: WorkflowTransition) => {
    if (!user) return;
    if (!canUserPerform(transition, myRoles, isGlobalAdmin)) {
      setError("No tienes permisos para esta acción en este proyecto.");
      return;
    }
    if (transition.requiresComment && !comment.trim()) {
      setError("Debes ingresar un comentario para esta acción.");
      return;
    }

    setBusy(transition.action);
    setError(null);

    const table = tableByKind[kind];
    const updatePayload: Record<string, unknown> = { status: transition.toStatus };
    if (kind === "memoria_valorizada") {
      updatePayload.reviewed_by = user.id;
      updatePayload.reviewed_at = new Date().toISOString();
    } else if (kind === "valuation") {
      if (transition.action === "reviewed") {
        updatePayload.resident_reviewed_by = user.id;
        updatePayload.resident_reviewed_at = new Date().toISOString();
      } else {
        updatePayload.supervisor_reviewed_by = user.id;
        updatePayload.supervisor_reviewed_at = new Date().toISOString();
        if (transition.requiresComment && comment.trim()) {
          updatePayload.supervisor_comment = comment.trim();
        }
      }
    } else if (kind === "liquidation" && transition.toStatus === "approved") {
      updatePayload.approved_by = user.id;
      updatePayload.approved_at = new Date().toISOString();
    }

    const { error: updErr } = await supabase
      .from(table)
      .update(updatePayload as never)
      .eq("id", entityId);
    if (updErr) {
      setError(updErr.message);
      setBusy(null);
      return;
    }

    const commentText = comment.trim() || `Acción: ${transition.label}`;
    const { error: commentErr } = await supabase.from("workflow_comments").insert({
      project_id: projectId,
      entity_type: kind,
      entity_id: entityId,
      action: transition.action,
      comment_text: commentText,
      created_by: user.id,
    });
    if (commentErr) {
      setError(commentErr.message);
    }

    setComment("");
    setBusy(null);
    await refresh();
    if (onChanged) await onChanged();
  };

  const postComment = async () => {
    if (!user) return;
    if (!comment.trim()) {
      setError("Escribe un comentario antes de enviar.");
      return;
    }
    setBusy("comment");
    setError(null);
    const { error: commentErr } = await supabase.from("workflow_comments").insert({
      project_id: projectId,
      entity_type: kind,
      entity_id: entityId,
      action: "commented",
      comment_text: comment.trim(),
      created_by: user.id,
    });
    if (commentErr) setError(commentErr.message);
    setComment("");
    setBusy(null);
    await refresh();
    if (onChanged) await onChanged();
  };

  return (
    <div className="mt-3 rounded-md border border-dashed border-border bg-muted/30 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Flujo {workflowEntityLabels[kind]}</span>
        {myRoles.length > 0 ? (
          myRoles.map((r) => (
            <Badge key={r} variant="secondary" className="text-[10px]">
              {r}
            </Badge>
          ))
        ) : isGlobalAdmin ? (
          <Badge variant="secondary" className="text-[10px]">admin global</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">sin rol en este proyecto</Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {availableTransitions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No hay acciones disponibles para tu rol en este estado.
          </p>
        ) : (
          availableTransitions.map((t) => (
            <Button
              key={t.action}
              size="sm"
              variant={t.variant ?? "outline"}
              disabled={busy !== null}
              onClick={() => performTransition(t)}
            >
              {busy === t.action ? "Procesando…" : t.label}
            </Button>
          ))
        )}
      </div>

      <div className="mt-3 space-y-2">
        <Textarea
          rows={2}
          placeholder="Comentario (obligatorio para observar/rechazar)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={postComment} disabled={busy !== null || !comment.trim()}>
            {busy === "comment" ? "Enviando…" : "Comentar"}
          </Button>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      {comments.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-border pt-2">
          {comments.map((c) => (
            <li key={c.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{profileName(c.created_by)}</span>
              {" · "}
              <span className="uppercase tracking-wide">{c.action}</span>
              {" · "}
              <span>{new Date(c.created_at).toLocaleString()}</span>
              <p className="mt-0.5 text-foreground">{c.comment_text}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
