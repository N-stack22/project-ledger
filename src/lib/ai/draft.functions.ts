// Server function: genera un borrador técnico para una memoria valorizada.
// - Arma el contexto leyendo la DB con el cliente autenticado del usuario (RLS aplica).
// - Delega la generación al AIProvider configurado por AI_PROVIDER.
// - No modifica nada en la base de datos: solo devuelve el borrador editable.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAIProvider } from "@/lib/ai/index.server";
import {
  AIProviderUnavailableError,
  DRAFT_SECTIONS,
  type DraftContext,
  type DraftSectionKey,
  type DraftSections,
} from "@/lib/ai/types";

const SectionEnum = z.enum([
  "generalidades",
  "ubicacion",
  "metas",
  "resumen_avance",
  "descripcion_partidas",
  "ocurrencias",
  "conclusiones",
]);

const InputSchema = z.object({
  project_id: z.string().uuid(),
  period_month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observations: z.string().max(2000).optional(),
  executive_summary: z.string().max(2000).optional(),
  sections: z.array(SectionEnum).optional(),
});

export type GenerateDraftResult =
  | { ok: true; provider: string; sections: DraftSections }
  | { ok: false; provider: string; error: string };

function periodLabel(periodMonth: string): string {
  const [y, m] = periodMonth.split("-").map(Number);
  const months = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  return `${months[(m ?? 1) - 1]} ${y}`;
}

export const generateTechnicalDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GenerateDraftResult> => {
    const { supabase } = context;

    // 1) Proyecto + ficha técnica
    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select(
        "id, code, name, entity_name, contractor_name, supervisor_name, resident_name, execution_modality, location, department, province, district, execution_contract, supervision_contract, contract_amount, start_date, planned_end_date, execution_term_days",
      )
      .eq("id", data.project_id)
      .maybeSingle();

    if (pErr || !project) {
      return { ok: false, provider: "n/a", error: "No se encontró el proyecto o no tienes acceso." };
    }

    // 2) Partidas (presupuesto)
    const { data: budgetItems = [] } = await supabase
      .from("budget_items")
      .select("id, item_code, description, unit, base_quantity, unit_price")
      .eq("project_id", data.project_id)
      .order("sort_order", { ascending: true });

    // 3) Metrados validados del período
    const { data: metrados = [] } = await supabase
      .from("metrado_entries")
      .select("item_id, quantity, entry_date, status")
      .eq("project_id", data.project_id)
      .eq("period_month", data.period_month)
      .eq("status", "validated");

    // 4) Valorización (si ya existe)
    const { data: valuation } = await supabase
      .from("valuations")
      .select("progress_percent, gross_amount, deductions_amount, net_amount")
      .eq("project_id", data.project_id)
      .eq("period_month", data.period_month)
      .maybeSingle();

    // 5) Líneas de valorización para cantidades por partida
    let lines: Array<{ item_id: string; quantity_period: number; quantity_accumulated: number }> = [];
    if (valuation) {
      const { data: valuationRow } = await supabase
        .from("valuations")
        .select("id")
        .eq("project_id", data.project_id)
        .eq("period_month", data.period_month)
        .maybeSingle();
      if (valuationRow?.id) {
        const { data: vlines = [] } = await supabase
          .from("valuation_lines")
          .select("item_id, quantity_period, quantity_accumulated")
          .eq("valuation_id", valuationRow.id);
        lines = vlines as typeof lines;
      }
    }

    const itemsById = new Map(budgetItems.map((it) => [it.id, it]));
    const linesByItem = new Map(lines.map((l) => [l.item_id, l]));

    // Solo incluimos partidas con alguna actividad (metrado o línea valorizada),
    // para no inflar el contexto enviado al modelo.
    const activeItemIds = new Set<string>([
      ...metrados.map((m) => m.item_id),
      ...lines.map((l) => l.item_id),
    ]);

    const partidas: DraftContext["partidas"] = [];
    for (const id of activeItemIds) {
      const it = itemsById.get(id);
      if (!it) continue;
      const ln = linesByItem.get(id);
      partidas.push({
        code: it.item_code ?? "",
        description: it.description,
        unit: it.unit,
        base_quantity: Number(it.base_quantity ?? 0),
        unit_price: Number(it.unit_price ?? 0),
        quantity_period: Number(ln?.quantity_period ?? 0),
        quantity_accumulated: Number(ln?.quantity_accumulated ?? 0),
      });
    }

    const metradosCtx: DraftContext["metrados"] = metrados.map((m) => {
      const it = itemsById.get(m.item_id);
      return {
        item_code: it?.item_code ?? "",
        description: it?.description ?? "",
        unit: it?.unit ?? "",
        quantity: Number(m.quantity),
        entry_date: m.entry_date,
      };
    });

    const draftContext: DraftContext = {
      project,
      period: { label: periodLabel(data.period_month), month: data.period_month },
      partidas,
      metrados: metradosCtx,
      valuation: valuation
        ? {
            progress_percent: Number(valuation.progress_percent),
            gross_amount: Number(valuation.gross_amount),
            deductions_amount: Number(valuation.deductions_amount),
            net_amount: Number(valuation.net_amount),
          }
        : null,
      observations: data.observations,
      executive_summary: data.executive_summary,
    };

    const targetSections: DraftSectionKey[] = data.sections?.length
      ? data.sections
      : DRAFT_SECTIONS.map((s) => s.key);

    const provider = getAIProvider();

    // Verificación previa para devolver un mensaje claro al usuario.
    const available = await provider.isAvailable();
    if (!available) {
      return {
        ok: false,
        provider: provider.name,
        error: `El proveedor de IA "${provider.name}" no está disponible. Revisa que el servidor esté activo y la configuración (OLLAMA_BASE_URL, OLLAMA_MODEL).`,
      };
    }

    try {
      const sections = await provider.generateTechnicalDraft(draftContext, targetSections);
      return { ok: true, provider: provider.name, sections };
    } catch (err) {
      const message =
        err instanceof AIProviderUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error desconocido al generar el borrador.";
      return { ok: false, provider: provider.name, error: message };
    }
  });
