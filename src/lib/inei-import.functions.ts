import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateIneiRows, type RowError } from "./inei-import.validation";

const RowSchema = z.object({
  period_month: z.string().min(1),
  code: z.string().min(1),
  description: z.string().max(255).nullable().optional(),
  value: z.union([z.number(), z.string()]),
});

const InputSchema = z.object({
  rows: z.array(RowSchema).min(1).max(5000),
});

export const importIneiIndices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Admin gate (RLS also enforces, but fail fast with a clear error).
    const { data: roleRow, error: roleErr } = await supabase
      .from("user_global_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["super_admin", "admin_empresa"])
      .maybeSingle();
    if (roleErr) throw new Error(`No se pudo verificar el rol: ${roleErr.message}`);
    if (!roleRow) throw new Error("Solo un administrador global puede importar índices INEI.");

    const { valid, errors } = validateIneiRows(data.rows);

    if (errors.length > 0) {
      // Reject the whole batch — backend enforces all-or-nothing on tampered input.
      return { ok: false as const, inserted: 0, errors: errors as RowError[] };
    }

    let inserted = 0;
    const chunkSize = 500;
    for (let i = 0; i < valid.length; i += chunkSize) {
      const slice = valid.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("inei_indices")
        .upsert(slice, { onConflict: "period_month,code" });
      if (error) {
        throw new Error(`Error al guardar índices (lote ${i / chunkSize + 1}): ${error.message}`);
      }
      inserted += slice.length;
    }

    return { ok: true as const, inserted, errors: [] as RowError[] };
  });
