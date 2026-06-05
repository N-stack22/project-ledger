import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const purgeInput = z.object({
  projectId: z.string().uuid(),
  confirmCode: z.string().min(1).max(64),
});

type PurgeChildTable =
  | "valuation_deductions"
  | "expediente_documents"
  | "liquidations"
  | "valuations"
  | "memoria_valorizada"
  | "metrado_lines"
  
  | "budget_items"
  | "budget_imports"
  | "valuation_periods"
  | "workflow_comments"
  | "audit_logs"
  | "project_members";

type StorageBucket = "budget-imports" | "project-documents" | "expedientes";

// Order matters: delete leaf/child rows before parents to respect existing or future FKs.
const CHILD_TABLES = [
  "valuation_deductions",
  "expediente_documents",
  "liquidations",
  "valuations",
  "memoria_valorizada",
  "metrado_lines",
  "metrado_entries",
  "budget_items",
  "budget_imports",
  "valuation_periods",
  "workflow_comments",
  "audit_logs",
  "project_members",
] as const satisfies readonly PurgeChildTable[];

function addStoragePath(paths: Map<StorageBucket, Set<string>>, bucket: StorageBucket, path?: string | null) {
  const cleanPath = path?.trim();
  if (!cleanPath) return;
  if (!paths.has(bucket)) paths.set(bucket, new Set());
  paths.get(bucket)!.add(cleanPath);
}

async function deleteByProjectId(table: PurgeChildTable, projectId: string) {
  const { error, count } = await supabaseAdmin
    .from(table)
    .delete({ count: "exact" })
    .eq("project_id", projectId);
  if (error) {
    throw new Error(`No se pudo limpiar ${table}: ${error.message}`);
  }
  return count ?? 0;
}

export const purgeProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => purgeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const deleted: Record<string, number> = {};

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

    // 3) Capture related storage paths before deleting database rows.
    const storagePaths = new Map<StorageBucket, Set<string>>();
    const [budgetFiles, projectDocs, memoriaDocs, valuationDocs, liquidationDocs] = await Promise.all([
      supabaseAdmin.from("budget_imports").select("file_path").eq("project_id", data.projectId),
      supabaseAdmin.from("expediente_documents").select("file_path").eq("project_id", data.projectId),
      supabaseAdmin.from("memoria_valorizada").select("document_path").eq("project_id", data.projectId),
      supabaseAdmin.from("valuations").select("generated_document_path").eq("project_id", data.projectId),
      supabaseAdmin.from("liquidations").select("generated_document_path").eq("project_id", data.projectId),
    ]);

    if (budgetFiles.error) throw new Error(`No se pudieron leer archivos de presupuesto: ${budgetFiles.error.message}`);
    if (projectDocs.error) throw new Error(`No se pudieron leer documentos del expediente: ${projectDocs.error.message}`);
    if (memoriaDocs.error) throw new Error(`No se pudieron leer PDFs de memoria: ${memoriaDocs.error.message}`);
    if (valuationDocs.error) throw new Error(`No se pudieron leer PDFs de valorización: ${valuationDocs.error.message}`);
    if (liquidationDocs.error) throw new Error(`No se pudieron leer PDFs de liquidación: ${liquidationDocs.error.message}`);

    budgetFiles.data?.forEach((row) => addStoragePath(storagePaths, "budget-imports", row.file_path));
    projectDocs.data?.forEach((row) => addStoragePath(storagePaths, "project-documents", row.file_path));
    projectDocs.data?.forEach((row) => addStoragePath(storagePaths, "expedientes", row.file_path));
    memoriaDocs.data?.forEach((row) => addStoragePath(storagePaths, "expedientes", row.document_path));
    valuationDocs.data?.forEach((row) => addStoragePath(storagePaths, "expedientes", row.generated_document_path));
    liquidationDocs.data?.forEach((row) => addStoragePath(storagePaths, "expedientes", row.generated_document_path));

    // 4) Special case: valuation_lines is keyed by valuation_id, not project_id.
    const { data: vals, error: valsError } = await supabaseAdmin
      .from("valuations")
      .select("id")
      .eq("project_id", data.projectId);
    if (valsError) throw new Error(`No se pudieron leer valorizaciones: ${valsError.message}`);
    const valuationIds = (vals ?? []).map((v) => v.id);
    if (valuationIds.length > 0) {
      const { error: vlError, count: vlCount } = await supabaseAdmin
        .from("valuation_lines")
        .delete({ count: "exact" })
        .in("valuation_id", valuationIds);
      if (vlError) throw new Error(`valuation_lines: ${vlError.message}`);
      deleted.valuation_lines = vlCount ?? 0;
    } else {
      deleted.valuation_lines = 0;
    }

    // 5) Delete storage objects related to the project before removing DB pointers.
    const buckets: StorageBucket[] = ["budget-imports", "project-documents", "expedientes"];
    for (const bucket of buckets) {
      const { data: list, error: listError } = await supabaseAdmin.storage
        .from(bucket)
        .list(data.projectId, { limit: 1000 });
      if (listError) throw new Error(`No se pudo listar archivos en ${bucket}: ${listError.message}`);
      list?.forEach((file) => addStoragePath(storagePaths, bucket, `${data.projectId}/${file.name}`));

      const paths = Array.from(storagePaths.get(bucket) ?? []);
      if (paths.length > 0) {
        const { error: removeError } = await supabaseAdmin.storage.from(bucket).remove(paths);
        if (removeError) throw new Error(`No se pudieron eliminar archivos en ${bucket}: ${removeError.message}`);
        deleted[`storage.${bucket}`] = paths.length;
      }
    }

    // 6) Delete child rows in order.
    for (const table of CHILD_TABLES) {
      deleted[table] = await deleteByProjectId(table, data.projectId);
    }

    // 7) Finally, delete the project itself and verify it really disappeared.
    const { error: projError, count: projectCount } = await supabaseAdmin
      .from("projects")
      .delete({ count: "exact" })
      .eq("id", data.projectId);
    if (projError) {
      throw new Error(`No se pudo eliminar el proyecto: ${projError.message}`);
    }
    if ((projectCount ?? 0) !== 1) {
      throw new Error("La operación terminó sin eliminar el proyecto padre. No se confirmó la purga.");
    }

    const { data: remainingProject, error: verifyError } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (verifyError) throw new Error(`No se pudo verificar la purga: ${verifyError.message}`);
    if (remainingProject) throw new Error("El proyecto todavía existe después de la purga.");

    // 8) Audit outside the deleted project scope.
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      project_id: null,
      actor_user_id: userId,
      entity_type: "projects",
      entity_id: data.projectId,
      action: "PURGE",
      previous_data: { project, deleted },
    });
    if (auditError) console.error("No se pudo registrar la auditoría de purga", auditError);

    return { success: true, deleted, project };
  });
