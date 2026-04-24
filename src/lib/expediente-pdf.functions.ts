import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createElement as h } from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import {
  buildValuationTable,
  deductionLabels,
  formatMoney,
  formatNum,
  totals,
  type MetradoLine,
} from "@/lib/expediente";

const inputSchema = z.object({
  projectId: z.string().uuid(),
  periodId: z.string().uuid(),
  accessToken: z.string().min(1, "Sesión inválida. Vuelve a iniciar sesión."),
});

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  cover: { padding: 60, alignItems: "center", justifyContent: "center", height: "100%" },
  coverTitle: { fontSize: 22, fontWeight: 700, marginBottom: 12, textAlign: "center" },
  coverSub: { fontSize: 14, textAlign: "center", marginBottom: 6 },
  coverMeta: { fontSize: 10, textAlign: "center", color: "#444", marginTop: 16 },
  separator: { borderBottom: "1pt solid #000", marginVertical: 6 },
  section: { marginBottom: 12 },
  h1: { fontSize: 14, fontWeight: 700, marginBottom: 8, borderBottom: "1pt solid #000", paddingBottom: 3 },
  h2: { fontSize: 11, fontWeight: 700, marginTop: 10, marginBottom: 4 },
  p: { marginBottom: 4, lineHeight: 1.4 },
  row: { flexDirection: "row" },
  th: { fontWeight: 700, backgroundColor: "#eee", padding: 3, borderRight: "0.5pt solid #888", borderBottom: "0.5pt solid #888", fontSize: 8, textAlign: "center" },
  td: { padding: 3, borderRight: "0.5pt solid #ccc", borderBottom: "0.5pt solid #ccc", fontSize: 8 },
  tdRight: { textAlign: "right" },
  tdCenter: { textAlign: "center" },
  fichaRow: { flexDirection: "row", borderBottom: "0.5pt solid #ccc", paddingVertical: 2 },
  fichaLabel: { width: "40%", fontWeight: 700, fontSize: 9 },
  fichaValue: { width: "60%", fontSize: 9 },
  pageHeader: { fontSize: 8, color: "#666", marginBottom: 8, borderBottom: "0.5pt solid #999", paddingBottom: 4 },
  signLine: { marginTop: 50, borderTop: "1pt solid #000", width: 200, textAlign: "center", paddingTop: 4, fontSize: 9 },
  signRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 40 },
  pageNumber: { position: "absolute", bottom: 18, right: 36, fontSize: 8, color: "#666" },
});

function getSupabaseEnv() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Falta configuración del backend para generar el expediente.");
  }

  return { supabaseUrl, supabasePublishableKey };
}

function createUserSupabaseClient(accessToken: string) {
  const { supabaseUrl, supabasePublishableKey } = getSupabaseEnv();

  return createClient<Database>(supabaseUrl, supabasePublishableKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "Error desconocido en server function.";
}

function FichaItem({ label, value }: { label: string; value: string }) {
  return h(View, { style: styles.fichaRow }, [
    h(Text, { key: "l", style: styles.fichaLabel }, label),
    h(Text, { key: "v", style: styles.fichaValue }, value || "-"),
  ]);
}

function Header({ project, period }: { project: any; period: any }) {
  return h(
    Text,
    { style: styles.pageHeader, fixed: true },
    `${project.name}  •  Valorización N° ${String(period.period_number).padStart(2, "0")}  •  Del ${period.date_from} al ${period.date_to}`,
  );
}

function PageNumber() {
  return h(Text, {
    style: styles.pageNumber,
    fixed: true,
    render: ({ pageNumber, totalPages }: any) => `Pág. ${pageNumber} / ${totalPages}`,
  } as any);
}

export const generateExpediente = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const supabase = createUserSupabaseClient(data.accessToken);
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(data.accessToken);

      if (authError || !user) {
        console.error("[Expediente] auth error", authError);
        return { ok: false, error: "Tu sesión expiró o no es válida. Vuelve a iniciar sesión." };
      }

      const permissionRes = await supabase.rpc("can_edit_project_data", {
        _project_id: data.projectId,
        _user_id: user.id,
      });

      if (permissionRes.error || permissionRes.data !== true) {
        console.error("[Expediente] permission error", permissionRes.error);
        return { ok: false, error: "No tienes permisos para generar el expediente de este proyecto." };
      }

      const [projectRes, periodRes, itemsRes, currentLinesRes, allPeriodsRes, deductionsRes] = await Promise.all([
        supabase.from("projects").select("*").eq("id", data.projectId).single(),
        supabase.from("valuation_periods").select("*").eq("id", data.periodId).eq("project_id", data.projectId).single(),
        supabase.from("budget_items").select("*").eq("project_id", data.projectId).order("sort_order"),
        supabase.from("metrado_lines").select("*").eq("period_id", data.periodId).eq("project_id", data.projectId).order("sort_order"),
        supabase.from("valuation_periods").select("id, period_number").eq("project_id", data.projectId),
        supabase.from("valuation_deductions").select("*").eq("period_id", data.periodId).eq("project_id", data.projectId),
      ]);

      if (projectRes.error || !projectRes.data) {
        console.error("[Expediente] project read error", projectRes.error);
        return { ok: false, error: "Error al leer los datos del proyecto o no tienes acceso a él." };
      }

      if (periodRes.error || !periodRes.data) {
        console.error("[Expediente] period read error", periodRes.error);
        return { ok: false, error: "Error al leer el período de valorización seleccionado." };
      }

      if (itemsRes.error) {
        console.error("[Expediente] items read error", itemsRes.error);
        return { ok: false, error: "Error al leer las partidas del presupuesto." };
      }

      if (currentLinesRes.error) {
        console.error("[Expediente] metrado lines read error", currentLinesRes.error);
        return { ok: false, error: "Error al leer los metrados del período." };
      }

      if (allPeriodsRes.error) {
        console.error("[Expediente] periods read error", allPeriodsRes.error);
        return { ok: false, error: "Error al calcular el acumulado de valorizaciones anteriores." };
      }

      if (deductionsRes.error) {
        console.error("[Expediente] deductions read error", deductionsRes.error);
        return { ok: false, error: "Error al leer las deducciones del período." };
      }

      const project = projectRes.data;
      const period = periodRes.data;
      const items = itemsRes.data ?? [];
      const currentLines = (currentLinesRes.data ?? []) as MetradoLine[];
      const allPeriods = allPeriodsRes.data ?? [];
      const deductions = deductionsRes.data ?? [];

      const missing: string[] = [];
      const requiredFichaFields: Array<[keyof typeof project, string]> = [
        ["entity_name", "Entidad"],
        ["contractor_name", "Contratista"],
        ["supervisor_name", "Supervisor"],
        ["resident_name", "Residente de obra"],
        ["execution_modality", "Modalidad de ejecución"],
        ["location", "Ubicación"],
        ["execution_contract", "Contrato de ejecución"],
        ["supervision_contract", "Contrato de supervisión"],
        ["start_date", "Fecha de inicio"],
        ["execution_term_days", "Plazo de ejecución (días)"],
      ];

      for (const [key, label] of requiredFichaFields) {
        const value = (project as any)[key];
        if (value == null || value === "" || value === 0) {
          missing.push(`Ficha técnica → ${label}`);
        }
      }

      if (!project.contract_amount || Number(project.contract_amount) <= 0) {
        missing.push("Ficha técnica → Monto contractual");
      }

      if (items.length === 0) {
        missing.push("Presupuesto → No hay partidas registradas para este proyecto");
      }

      if (currentLines.length === 0) {
        missing.push("Metrados → No hay metrados detallados registrados para este período");
      }

      const previousPeriodIds = allPeriods
        .filter((row) => row.period_number < period.period_number)
        .map((row) => row.id);

      let previousLines: MetradoLine[] = [];
      if (previousPeriodIds.length > 0) {
        const previousLinesRes = await supabase
          .from("metrado_lines")
          .select("*")
          .eq("project_id", data.projectId)
          .in("period_id", previousPeriodIds);

        if (previousLinesRes.error) {
          console.error("[Expediente] previous metrado lines read error", previousLinesRes.error);
          return { ok: false, error: "Error al leer los metrados acumulados de períodos anteriores." };
        }

        previousLines = (previousLinesRes.data ?? []) as MetradoLine[];
      }

      const valTable = buildValuationTable({
        items,
        currentLines,
        previousLines,
      });
      const t = totals(valTable);
      const totalDeductions = deductions.reduce((acc: number, row: any) => acc + Number(row.amount || 0), 0);
      const netAmount = t.current - totalDeductions;
      const currency = project.currency_code || "PEN";

      if (t.current <= 0) {
        missing.push("Valorización → Los metrados del período no generan una valorización mayor a 0");
      }

      if (missing.length > 0) {
        return {
          ok: false,
          error: "Falta información para generar el expediente:\n• " + missing.join("\n• "),
        };
      }

      const linesByItem = new Map<string, MetradoLine[]>();
      for (const line of currentLines) {
        const group = linesByItem.get(line.item_id) ?? [];
        group.push(line);
        linesByItem.set(line.item_id, group);
      }
      const itemMap = new Map(items.map((item: any) => [item.id, item]));

      const resumenMetrados = items
        .map((item: any) => ({
          item,
          total: (linesByItem.get(item.id) ?? []).reduce((acc, row) => acc + Number(row.partial || 0), 0),
        }))
        .filter((row: any) => row.total > 0);

      const doc = h(Document, {}, [
        h(Page, { key: "cover", size: "A4", style: styles.page }, [
          h(View, { style: styles.cover }, [
            h(Text, { style: styles.coverTitle }, "EXPEDIENTE MENSUAL DE SUPERVISIÓN / VALORIZACIÓN"),
            h(Text, { style: styles.coverSub }, project.name),
            h(Text, { style: styles.coverSub }, `Valorización N° ${String(period.period_number).padStart(2, "0")}`),
            h(Text, { style: styles.coverMeta }, `Período: del ${period.date_from} al ${period.date_to}`),
            h(Text, { style: styles.coverMeta }, `Entidad: ${project.entity_name || "-"}`),
            h(Text, { style: styles.coverMeta }, `Contratista: ${project.contractor_name || "-"}`),
            h(Text, { style: styles.coverMeta }, `Ubicación: ${[project.location, project.district, project.province, project.department].filter(Boolean).join(", ") || "-"}`),
          ]),
        ]),

        h(Page, { key: "indice", size: "A4", style: styles.page }, [
          Header({ project, period }),
          h(Text, { style: styles.h1 }, "ÍNDICE"),
          ...[
            "1. Carta de presentación",
            "2. Ficha técnica de obra",
            "3. Memoria valorizada e informe técnico",
            "4. Metrados ejecutados — Hoja resumen",
            "5. Planillas de metrados por partida",
            "6. Cuadro de valorización de obra",
            "7. Resumen de valorización y deducciones",
          ].map((text, index) => h(Text, { key: index, style: styles.p }, text)),
          PageNumber(),
        ]),

        h(Page, { key: "ficha", size: "A4", style: styles.page }, [
          Header({ project, period }),
          h(Text, { style: styles.h1 }, "FICHA TÉCNICA DE OBRA"),
          FichaItem({ label: "Nombre de la obra", value: project.name }),
          FichaItem({ label: "Código", value: project.code }),
          FichaItem({ label: "Entidad", value: project.entity_name || "-" }),
          FichaItem({ label: "Unidad ejecutora", value: project.executing_unit || "-" }),
          FichaItem({ label: "Contratista", value: project.contractor_name || "-" }),
          FichaItem({ label: "Modalidad de ejecución", value: project.execution_modality || "-" }),
          FichaItem({ label: "Contrato de ejecución", value: project.execution_contract || "-" }),
          FichaItem({ label: "Contrato de supervisión", value: project.supervision_contract || "-" }),
          FichaItem({ label: "Subgerente", value: project.subgerente_name || "-" }),
          FichaItem({ label: "Residente de obra", value: project.resident_name || "-" }),
          FichaItem({ label: "Supervisor", value: project.supervisor_name || "-" }),
          FichaItem({ label: "Ubicación", value: [project.location, project.district, project.province, project.department].filter(Boolean).join(", ") || "-" }),
          FichaItem({ label: "Fecha de entrega de terreno", value: project.site_handover_date || "-" }),
          FichaItem({ label: "Fecha de inicio", value: project.start_date || "-" }),
          FichaItem({ label: "Plazo de ejecución (días)", value: String(project.execution_term_days || "-") }),
          FichaItem({ label: "Fecha de término planificada", value: project.planned_completion_date || "-" }),
          FichaItem({ label: "Ampliaciones (días)", value: String(project.extensions_days || 0) }),
          FichaItem({ label: "Adicionales", value: formatMoney(Number(project.additionals_amount || 0), currency) }),
          FichaItem({ label: "Deductivos", value: formatMoney(Number(project.deductives_amount || 0), currency) }),
          FichaItem({ label: "Nueva fecha de término", value: project.new_completion_date || "-" }),
          FichaItem({ label: "Estado actual", value: project.status }),
          h(Text, { style: styles.h2 }, "Presupuesto de la obra"),
          FichaItem({ label: "Costo directo", value: formatMoney(Number(project.direct_cost || 0), currency) }),
          FichaItem({ label: "Gastos generales", value: formatMoney(Number(project.overhead_cost || 0), currency) }),
          FichaItem({ label: "Utilidad", value: formatMoney(Number(project.utility_amount || 0), currency) }),
          FichaItem({ label: "IGV", value: formatMoney(Number(project.igv_amount || 0), currency) }),
          FichaItem({ label: "Monto contractual", value: formatMoney(Number(project.contract_amount || 0), currency) }),
          FichaItem({ label: "Monto del expediente técnico", value: formatMoney(Number(project.expediente_amount || 0), currency) }),
          PageNumber(),
        ]),

        h(Page, { key: "memoria", size: "A4", style: styles.page }, [
          Header({ project, period }),
          h(Text, { style: styles.h1 }, "MEMORIA VALORIZADA E INFORME TÉCNICO"),
          h(Text, { style: styles.h2 }, "1. Generalidades"),
          h(Text, { style: styles.p }, period.generalidades || "-"),
          h(Text, { style: styles.h2 }, "2. Ubicación"),
          h(Text, { style: styles.p }, [project.location, project.district, project.province, project.department].filter(Boolean).join(", ") || "-"),
          h(Text, { style: styles.h2 }, "3. Metas del proyecto"),
          h(Text, { style: styles.p }, period.metas || "-"),
          h(Text, { style: styles.h2 }, "4. Resumen de avances"),
          h(Text, { style: styles.p }, `Avance acumulado anterior: ${formatMoney(t.prev, currency)}`),
          h(Text, { style: styles.p }, `Avance del período: ${formatMoney(t.current, currency)}`),
          h(Text, { style: styles.p }, `Avance acumulado a la fecha: ${formatMoney(t.accum, currency)}`),
          h(Text, { style: styles.p }, `Saldo por valorizar: ${formatMoney(t.balance, currency)}`),
          h(Text, { style: styles.h2 }, "5. Valorización a pagar"),
          h(Text, { style: styles.p }, `Bruto del período: ${formatMoney(t.current, currency)}`),
          h(Text, { style: styles.p }, `Total deducciones: ${formatMoney(totalDeductions, currency)}`),
          h(Text, { style: styles.p }, `MONTO NETO A PAGAR: ${formatMoney(netAmount, currency)}`),
          h(Text, { style: styles.h2 }, "6. Ocurrencias y desarrollo de la obra"),
          h(Text, { style: styles.p }, period.ocurrencias || "-"),
          h(Text, { style: styles.h2 }, "7. Conclusiones"),
          h(Text, { style: styles.p }, period.conclusiones || "-"),
          PageNumber(),
        ]),

        h(Page, { key: "resumen-met", size: "A4", style: styles.page }, [
          Header({ project, period }),
          h(Text, { style: styles.h1 }, "HOJA RESUMEN DE METRADOS — PERÍODO"),
          h(View, { style: styles.row }, [
            h(Text, { style: [styles.th, { width: "12%" }] }, "Ítem"),
            h(Text, { style: [styles.th, { width: "58%" }] }, "Descripción"),
            h(Text, { style: [styles.th, { width: "10%" }] }, "Und."),
            h(Text, { style: [styles.th, { width: "20%" }] }, "Total"),
          ]),
          ...resumenMetrados.map((row: any, index: number) =>
            h(View, { key: index, style: styles.row }, [
              h(Text, { style: [styles.td, { width: "12%" }] }, row.item.item_code || "-"),
              h(Text, { style: [styles.td, { width: "58%" }] }, row.item.description),
              h(Text, { style: [styles.td, styles.tdCenter, { width: "10%" }] }, row.item.unit),
              h(Text, { style: [styles.td, styles.tdRight, { width: "20%" }] }, formatNum(row.total, 2)),
            ]),
          ),
          PageNumber(),
        ]),

        h(Page, { key: "planillas", size: "A4", style: styles.page }, [
          Header({ project, period }),
          h(Text, { style: styles.h1 }, "PLANILLAS DE METRADOS POR PARTIDA"),
          ...Array.from(linesByItem.entries()).flatMap(([itemId, lines], index) => {
            const item: any = itemMap.get(itemId);
            if (!item) return [];
            return [
              h(View, { key: `item-${index}`, style: { marginTop: 8 } }, [
                h(Text, { style: styles.h2 }, `${item.item_code || ""}  ${item.description}  (${item.unit})`),
                h(View, { style: styles.row }, [
                  h(Text, { style: [styles.th, { width: "20%" }] }, "Ubicación"),
                  h(Text, { style: [styles.th, { width: "28%" }] }, "Descripción"),
                  h(Text, { style: [styles.th, { width: "8%" }] }, "N°"),
                  h(Text, { style: [styles.th, { width: "10%" }] }, "Largo"),
                  h(Text, { style: [styles.th, { width: "10%" }] }, "Ancho"),
                  h(Text, { style: [styles.th, { width: "10%" }] }, "Alto"),
                  h(Text, { style: [styles.th, { width: "14%" }] }, "Parcial"),
                ]),
                ...lines.map((line, lineIndex) =>
                  h(View, { key: lineIndex, style: styles.row }, [
                    h(Text, { style: [styles.td, { width: "20%" }] }, [line.group_label, line.location_ref].filter(Boolean).join(" / ")),
                    h(Text, { style: [styles.td, { width: "28%" }] }, line.description || ""),
                    h(Text, { style: [styles.td, styles.tdCenter, { width: "8%" }] }, formatNum(Number(line.num_elements ?? 1), 2)),
                    h(Text, { style: [styles.td, styles.tdRight, { width: "10%" }] }, line.length != null ? formatNum(Number(line.length), 2) : "-"),
                    h(Text, { style: [styles.td, styles.tdRight, { width: "10%" }] }, line.width != null ? formatNum(Number(line.width), 2) : "-"),
                    h(Text, { style: [styles.td, styles.tdRight, { width: "10%" }] }, line.height != null ? formatNum(Number(line.height), 2) : "-"),
                    h(Text, { style: [styles.td, styles.tdRight, { width: "14%" }] }, formatNum(Number(line.partial), 2)),
                  ]),
                ),
              ]),
            ];
          }),
          PageNumber(),
        ]),

        h(Page, { key: "valorizacion", size: "A4", orientation: "landscape", style: styles.page }, [
          Header({ project, period }),
          h(Text, { style: styles.h1 }, "CUADRO DE VALORIZACIÓN DE OBRA"),
          h(View, { style: styles.row }, [
            h(Text, { style: [styles.th, { width: "6%" }] }, "Ítem"),
            h(Text, { style: [styles.th, { width: "20%" }] }, "Descripción"),
            h(Text, { style: [styles.th, { width: "4%" }] }, "Und"),
            h(Text, { style: [styles.th, { width: "6%" }] }, "Met."),
            h(Text, { style: [styles.th, { width: "7%" }] }, "P.U."),
            h(Text, { style: [styles.th, { width: "8%" }] }, "Subtotal"),
            h(Text, { style: [styles.th, { width: "7%" }] }, "Ant. met."),
            h(Text, { style: [styles.th, { width: "8%" }] }, "Ant. monto"),
            h(Text, { style: [styles.th, { width: "7%" }] }, "Act. met."),
            h(Text, { style: [styles.th, { width: "8%" }] }, "Act. monto"),
            h(Text, { style: [styles.th, { width: "7%" }] }, "Acum. met."),
            h(Text, { style: [styles.th, { width: "8%" }] }, "Acum. monto"),
            h(Text, { style: [styles.th, { width: "4%" }] }, "%"),
          ]),
          ...valTable.map((row, index) =>
            h(View, { key: index, style: styles.row }, [
              h(Text, { style: [styles.td, { width: "6%" }] }, row.item.item_code || "-"),
              h(Text, { style: [styles.td, { width: "20%" }] }, row.item.description),
              h(Text, { style: [styles.td, styles.tdCenter, { width: "4%" }] }, row.item.unit),
              h(Text, { style: [styles.td, styles.tdRight, { width: "6%" }] }, formatNum(Number(row.item.base_quantity), 2)),
              h(Text, { style: [styles.td, styles.tdRight, { width: "7%" }] }, formatNum(Number(row.item.unit_price), 2)),
              h(Text, { style: [styles.td, styles.tdRight, { width: "8%" }] }, formatNum(Number(row.item.base_quantity) * Number(row.item.unit_price), 2)),
              h(Text, { style: [styles.td, styles.tdRight, { width: "7%" }] }, formatNum(row.qtyPrev, 2)),
              h(Text, { style: [styles.td, styles.tdRight, { width: "8%" }] }, formatNum(row.amountPrev, 2)),
              h(Text, { style: [styles.td, styles.tdRight, { width: "7%" }] }, formatNum(row.qtyCurrent, 2)),
              h(Text, { style: [styles.td, styles.tdRight, { width: "8%" }] }, formatNum(row.amountCurrent, 2)),
              h(Text, { style: [styles.td, styles.tdRight, { width: "7%" }] }, formatNum(row.qtyAccum, 2)),
              h(Text, { style: [styles.td, styles.tdRight, { width: "8%" }] }, formatNum(row.amountAccum, 2)),
              h(Text, { style: [styles.td, styles.tdRight, { width: "4%" }] }, formatNum(row.pctAccum, 1)),
            ]),
          ),
          h(View, { style: [styles.row, { marginTop: 4 }] }, [
            h(Text, { style: [styles.td, { width: "30%", fontWeight: 700 }] }, "TOTALES"),
            h(Text, { style: [styles.td, { width: "10%" }] }, ""),
            h(Text, { style: [styles.td, styles.tdRight, { width: "8%", fontWeight: 700 }] }, formatNum(t.base, 2)),
            h(Text, { style: [styles.td, { width: "7%" }] }, ""),
            h(Text, { style: [styles.td, styles.tdRight, { width: "8%", fontWeight: 700 }] }, formatNum(t.prev, 2)),
            h(Text, { style: [styles.td, { width: "7%" }] }, ""),
            h(Text, { style: [styles.td, styles.tdRight, { width: "8%", fontWeight: 700 }] }, formatNum(t.current, 2)),
            h(Text, { style: [styles.td, { width: "7%" }] }, ""),
            h(Text, { style: [styles.td, styles.tdRight, { width: "8%", fontWeight: 700 }] }, formatNum(t.accum, 2)),
            h(Text, { style: [styles.td, { width: "4%" }] }, ""),
          ]),
          PageNumber(),
        ]),

        h(Page, { key: "resumen", size: "A4", style: styles.page }, [
          Header({ project, period }),
          h(Text, { style: styles.h1 }, "RESUMEN DE VALORIZACIÓN DE OBRA"),
          FichaItem({ label: "Proyecto", value: project.name }),
          FichaItem({ label: "Entidad", value: project.entity_name || "-" }),
          FichaItem({ label: "Contratista", value: project.contractor_name || "-" }),
          FichaItem({ label: "Modalidad", value: project.execution_modality || "-" }),
          FichaItem({ label: "Período", value: `${period.date_from}  →  ${period.date_to}` }),
          FichaItem({ label: "Valorización N°", value: String(period.period_number) }),
          h(Text, { style: styles.h2 }, "Montos"),
          FichaItem({ label: "Monto contractual", value: formatMoney(Number(project.contract_amount || 0), currency) }),
          FichaItem({ label: "Acumulado anterior", value: formatMoney(t.prev, currency) }),
          FichaItem({ label: "Valorización del período (bruto)", value: formatMoney(t.current, currency) }),
          FichaItem({ label: "Acumulado a la fecha", value: formatMoney(t.accum, currency) }),
          FichaItem({ label: "Saldo por valorizar", value: formatMoney(t.balance, currency) }),
          h(Text, { style: styles.h2 }, "Deducciones"),
          h(View, { style: styles.row }, [
            h(Text, { style: [styles.th, { width: "70%" }] }, "Concepto"),
            h(Text, { style: [styles.th, { width: "30%" }] }, "Monto"),
          ]),
          ...((deductions ?? []).length === 0
            ? [h(Text, { style: styles.p }, "Sin deducciones registradas.")]
            : (deductions ?? []).map((deduction: any, index: number) =>
                h(View, { key: index, style: styles.row }, [
                  h(Text, { style: [styles.td, { width: "70%" }] }, `${deductionLabels[deduction.deduction_type]}${deduction.description ? ` — ${deduction.description}` : ""}`),
                  h(Text, { style: [styles.td, styles.tdRight, { width: "30%" }] }, formatMoney(Number(deduction.amount), currency)),
                ]),
              )),
          h(View, { style: styles.row }, [
            h(Text, { style: [styles.td, { width: "70%", fontWeight: 700 }] }, "TOTAL DEDUCCIONES"),
            h(Text, { style: [styles.td, styles.tdRight, { width: "30%", fontWeight: 700 }] }, formatMoney(totalDeductions, currency)),
          ]),
          h(View, { style: [styles.row, { marginTop: 6 }] }, [
            h(Text, { style: [styles.td, { width: "70%", fontWeight: 700, backgroundColor: "#f5f5f5" }] }, "MONTO NETO A PAGAR"),
            h(Text, { style: [styles.td, styles.tdRight, { width: "30%", fontWeight: 700, backgroundColor: "#f5f5f5" }] }, formatMoney(netAmount, currency)),
          ]),
          h(View, { style: styles.signRow }, [
            h(Text, { style: styles.signLine }, project.resident_name ? `Ing. ${project.resident_name}\nResidente de Obra` : "Residente de Obra"),
            h(Text, { style: styles.signLine }, project.supervisor_name ? `Ing. ${project.supervisor_name}\nSupervisor` : "Supervisor"),
          ]),
          PageNumber(),
        ]),
      ]);

      let buffer: Buffer;
      try {
        buffer = await renderToBuffer(doc as any);
      } catch (error) {
        console.error("[Expediente] PDF render error", error);
        return { ok: false, error: `Error en generación PDF: ${getErrorMessage(error)}` };
      }

      if (!buffer || buffer.length === 0) {
        return { ok: false, error: "Error en generación PDF: el archivo generado está vacío." };
      }

      const bytes = new Uint8Array(buffer);
      const fileName = `expediente-${project.code}-val${String(period.period_number).padStart(2, "0")}-${Date.now()}.pdf`;
      const filePath = `${project.id}/${fileName}`;

      const uploadRes = await supabaseAdmin.storage
        .from("expedientes")
        .upload(filePath, bytes, { contentType: "application/pdf", upsert: true });

      if (uploadRes.error) {
        console.error("[Expediente] upload error", uploadRes.error);
        return { ok: false, error: `Error al guardar el PDF generado: ${uploadRes.error.message}` };
      }

      const insertRes = await supabaseAdmin.from("expediente_documents").insert({
        project_id: project.id,
        period_id: period.id,
        file_path: filePath,
        file_name: fileName,
        total_valued: t.current,
        total_deductions: totalDeductions,
        net_amount: netAmount,
        generated_by: user.id,
      });

      if (insertRes.error) {
        console.error("[Expediente] document register error", insertRes.error);
        return { ok: false, error: `Error al registrar el expediente generado: ${insertRes.error.message}` };
      }

      const signedRes = await supabaseAdmin.storage
        .from("expedientes")
        .createSignedUrl(filePath, 60 * 60 * 24);

      if (signedRes.error || !signedRes.data?.signedUrl) {
        console.error("[Expediente] signed URL error", signedRes.error);
        return { ok: false, error: "El PDF se generó, pero no se pudo crear el enlace de descarga." };
      }

      return {
        ok: true,
        fileName,
        filePath,
        signedUrl: signedRes.data.signedUrl,
      };
    } catch (error) {
      console.error("[Expediente] server function error", error);
      return { ok: false, error: `Error en server function: ${getErrorMessage(error)}` };
    }
  });
