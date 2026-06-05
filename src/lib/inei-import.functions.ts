import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Keep these rules in sync with the client-side validator in
// src/components/app/reajustes-page.tsx (parseIndicesCsv). The backend
// re-validates everything so a tampered client cannot bypass checks.
const PERIOD_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Za-z0-9._-]+$/;

function normalizePeriod(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let y: number, mo: number, d: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { [y, mo, d] = v.split("-").map(Number); }
  else if (/^\d{4}-\d{2}$/.test(v)) { const [yy, mm] = v.split("-").map(Number); y = yy; mo = mm; d = 1; }
  else {
    const m1 = v.match(/^(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?$/);
    const m2 = v.match(/^(\d{1,2})[/-](\d{4})$/);
    if (m1) { y = +m1[1]; mo = +m1[2]; d = m1[3] ? +m1[3] : 1; }
    else if (m2) { y = +m2[2]; mo = +m2[1]; d = 1; }
    else return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2999) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

const RowSchema = z.object({
  period_month: z.string().min(1),
  code: z.string().min(1),
  description: z.string().max(255).nullable().optional(),
  value: z.union([z.number(), z.string()]),
});

const InputSchema = z.object({
  rows: z.array(RowSchema).min(1).max(5000),
});

type RowError = { line: number; field: string; message: string };

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

    const errors: RowError[] = [];
    const valid: { period_month: string; code: string; description: string | null; value: number }[] = [];
    const seenKey = new Map<string, number>();

    data.rows.forEach((raw, idx) => {
      const line = idx + 1;
      const rowErrs: RowError[] = [];

      const period = normalizePeriod(String(raw.period_month ?? ""));
      if (!period || !PERIOD_RE.test(period)) {
        rowErrs.push({ line, field: "period_month", message: `Mes inválido: "${raw.period_month}".` });
      }

      const code = String(raw.code ?? "").trim();
      if (!code) rowErrs.push({ line, field: "code", message: "Código vacío." });
      else if (code.length > 32) rowErrs.push({ line, field: "code", message: `Código demasiado largo (${code.length}>32).` });
      else if (!CODE_RE.test(code)) rowErrs.push({ line, field: "code", message: `Caracteres inválidos en código: "${code}".` });

      const description = raw.description ? String(raw.description).trim() || null : null;
      if (description && description.length > 255) {
        rowErrs.push({ line, field: "description", message: `Descripción demasiado larga (${description.length}>255).` });
      }

      let value = NaN;
      const rawVal = typeof raw.value === "number" ? String(raw.value) : String(raw.value ?? "").trim();
      if (!rawVal) {
        rowErrs.push({ line, field: "value", message: "Valor vacío." });
      } else {
        const normalized = rawVal.replace(/\s/g, "").replace(",", ".");
        if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
          rowErrs.push({ line, field: "value", message: `Valor no numérico: "${rawVal}".` });
        } else {
          value = Number(normalized);
          if (!Number.isFinite(value)) rowErrs.push({ line, field: "value", message: `Valor fuera de rango.` });
          else if (value <= 0) rowErrs.push({ line, field: "value", message: `Valor debe ser mayor que 0.` });
          else if (value > 100000) rowErrs.push({ line, field: "value", message: `Valor sospechosamente alto (${value}).` });
        }
      }

      if (period && code && !rowErrs.some((e) => e.field === "period_month" || e.field === "code")) {
        const key = `${period}|${code}`;
        const prev = seenKey.get(key);
        if (prev !== undefined) {
          rowErrs.push({ line, field: "_row", message: `Duplicado intra-archivo de la línea ${prev}.` });
        } else {
          seenKey.set(key, line);
        }
      }

      if (rowErrs.length > 0) {
        errors.push(...rowErrs);
      } else {
        valid.push({ period_month: period!, code, description, value });
      }
    });

    if (errors.length > 0) {
      // Reject the whole batch — backend enforces all-or-nothing on tampered input.
      return { ok: false as const, inserted: 0, errors };
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
