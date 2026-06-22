// Server fn: busca el factor K aplicable a un período (proyecto+mes) usando la
// fórmula polinómica vigente y los índices INEI registrados.
// Devuelve K=1 cuando faltan datos, para no bloquear la valorización.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calcReajuste, type Monomio, type IndexValue } from "@/lib/reajuste";

const Input = z.object({
  project_id: z.string().uuid(),
  period_month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type LookupReajusteKResult =
  | { ok: true; k: number; missingIndices: string[]; formulaId: string }
  | { ok: false; reason: "no_formula" | "no_indices"; k: 1 };

export const lookupReajusteK = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<LookupReajusteKResult> => {
    const { supabase } = context;
    const { data: formulaRow } = await supabase
      .from("polynomial_formulas")
      .select("id, monomios")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!formulaRow) return { ok: false, reason: "no_formula", k: 1 };

    const monomios = (formulaRow.monomios as unknown as Monomio[]) ?? [];
    if (!monomios.length) return { ok: false, reason: "no_formula", k: 1 };

    const { data: indices } = await supabase
      .from("inei_indices")
      .select("code, value, period_month")
      .eq("period_month", data.period_month);

    const periodIndices: IndexValue[] = (indices ?? []).map((row) => ({
      code: row.code,
      value: Number(row.value),
    }));

    if (!periodIndices.length) return { ok: false, reason: "no_indices", k: 1 };

    const result = calcReajuste(monomios, periodIndices, 0);
    const missingIndices = result.detail.filter((d) => d.missing).map((d) => d.symbol);
    return { ok: true, k: result.k || 1, missingIndices, formulaId: formulaRow.id };
  });
