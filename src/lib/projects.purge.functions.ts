import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const purgeInput = z.object({
  projectId: z.string().uuid(),
  confirmCode: z.string().min(1).max(64),
});

// Order matters: delete leaf/child rows before parents to respect any FK if added later.
const CHILD_TABLES = [
  "valuation_lines", // depends on valuations (filtered by project via valuation lookup)
  "valuation_deductions",
  "valuation_periods",
  "valuations",
  "memoria_valorizada",
  "metrado_lines",
  "metrado_entries",
  "budget_items",
  "budget_imports",
  "expediente_documents",
  "workflow_comments",
  "audit_logs",
  "project_members",
] as const;

export const purgeProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => purgeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Verify caller is admin (RLS-checked)
    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError) {
      throw new Error(`No se pudo verificar el rol: ${roleError.message}`);
    }
    if (!roleRow) {
      throw new Error("Solo un administrador puede purgar un proyecto.");
    }

    // 2) Load project and verify confirmation code matches
    const { data: project, error: projectError } = await supabaseAdmin
      .from("projects")
      .select("id, code, name")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projectError) throw new Error(projectError.message);
    if (!project) throw new Error("Proyecto no encontrado.");

    if (data.confirmCode.trim().toUpperCase() !== project.code.trim().toUpperCase()) {
      throw new Error("El código de confirmación no coincide con el código del proyecto.");
    }

    // 3) Special case: valuation_lines is keyed by valuation_id, not project_id.
    const { data: vals } = await supabaseAdmin
      .from("valuations")
      .select("id")
      .eq("project_id", data.projectId);
    const valuationIds = (vals ?? []).map((v) => v.id);
    if (valuationIds.length > 0) {
      const { error: vlError } = await supabaseAdmin
        .from("valuation_lines")
        .delete()
        .in("valuation_id", valuationIds);
      if (vlError) throw new Error(`valuation_lines: ${vlError.message}`);
    }

    // 4) Delete storage objects related to the project (best-effort)
    const buckets = ["budget-imports", "project-documents", "expedientes"];
    for (const bucket of buckets) {
      try {
        const { data: list } = await supabaseAdmin.storage
          .from(bucket)
          .list(data.projectId, { limit: 1000 });
        if (list && list.length > 0) {
          const paths = list.map((f) => `${data.projectId}/${f.name}`);
          await supabaseAdmin.storage.from(bucket).remove(paths);
        }
      } catch {
        // ignore — storage cleanup is best-effort
      }
    }

    // 5) Delete child rows in order
    const deleted: Record<string, number> = {};
    for (const table of CHILD_TABLES) {
      if (table === "valuation_lines") continue; // already done
      const { error, count } = await supabaseAdmin
        .from(table)
        .delete({ count: "exact" })
        .eq("project_id", data.projectId);
      if (error) {
        throw new Error(`No se pudo limpiar ${table}: ${error.message}`);
      }
      deleted[table] = count ?? 0;
    }
    deleted.valuation_lines = valuationIds.length;

    // 6) Finally, delete the project itself
    const { error: projError } = await supabaseAdmin
      .from("projects")
      .delete()
      .eq("id", data.projectId);
    if (projError) {
      throw new Error(`No se pudo eliminar el proyecto: ${projError.message}`);
    }

    // 7) Audit
    await supabaseAdmin.from("audit_logs").insert({
      project_id: null,
      actor_user_id: userId,
      entity_type: "projects",
      entity_id: data.projectId,
      action: "PURGE",
      previous_data: { project, deleted },
    });

    return { success: true, deleted, project };
  });
