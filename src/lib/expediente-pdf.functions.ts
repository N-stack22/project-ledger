import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createElement as h, Fragment } from "react";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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

function FichaItem({ label, value }: { label: string; value: string }) {
  return h(View, { style: styles.fichaRow }, [
    h(Text, { key: "l", style: styles.fichaLabel }, label),
    h(Text, { key: "v", style: styles.fichaValue }, value || "-"),
  ]);
}

function Header({ project, period }: { project: any; period: any }) {
  return h(Text, { style: styles.pageHeader, fixed: true },
    `${project.name}  •  Valorización N° ${String(period.period_number).padStart(2, "0")}  •  Del ${period.date_from} al ${period.date_to}`);
}

function PageNumber() {
  return h(Text, {
    style: styles.pageNumber,
    fixed: true,
    render: ({ pageNumber, totalPages }: any) => `Pág. ${pageNumber} / ${totalPages}`,
  } as any);
}

export const generateExpediente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    const [{ data: project }, { data: period }, { data: items }, { data: currentLines }, { data: previousPeriods }, { data: deductions }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", data.projectId).single(),
      supabase.from("valuation_periods").select("*").eq("id", data.periodId).single(),
      supabase.from("budget_items").select("*").eq("project_id", data.projectId).order("sort_order"),
      supabase.from("metrado_lines").select("*").eq("period_id", data.periodId),
      supabase.from("valuation_periods").select("id").eq("project_id", data.projectId).lt("period_number", 9999),
      supabase.from("valuation_deductions").select("*").eq("period_id", data.periodId),
    ]);

    if (!project || !period) throw new Error("Proyecto o período no encontrado");

    // Líneas previas: de períodos anteriores a este
    const prevIds = (previousPeriods ?? []).filter((p: any) => p.id !== data.periodId).map((p: any) => p.id);
    let previousLines: MetradoLine[] = [];
    if (prevIds.length > 0) {
      const { data: prevLines } = await supabase
        .from("metrado_lines")
        .select("*")
        .in("period_id", prevIds);
      // Solo cuenta líneas de períodos con number < period.period_number
      const { data: allPeriods } = await supabase
        .from("valuation_periods")
        .select("id, period_number")
        .eq("project_id", data.projectId);
      const validIds = new Set(
        (allPeriods ?? []).filter((p: any) => p.period_number < period.period_number).map((p: any) => p.id),
      );
      previousLines = (prevLines ?? []).filter((l: any) => validIds.has(l.period_id));
    }

    const valTable = buildValuationTable({
      items: items ?? [],
      currentLines: (currentLines ?? []) as MetradoLine[],
      previousLines,
    });
    const t = totals(valTable);
    const totalDeductions = (deductions ?? []).reduce((a: number, d: any) => a + Number(d.amount || 0), 0);
    const netAmount = t.current - totalDeductions;
    const currency = project.currency_code || "PEN";

    // Agrupa metrados por partida para planillas
    const linesByItem = new Map<string, MetradoLine[]>();
    for (const l of (currentLines ?? []) as MetradoLine[]) {
      const arr = linesByItem.get(l.item_id) ?? [];
      arr.push(l);
      linesByItem.set(l.item_id, arr);
    }
    const itemMap = new Map((items ?? []).map((i: any) => [i.id, i]));

    // Hoja resumen de metrados (solo período actual)
    const resumenMetrados = (items ?? [])
      .map((it: any) => ({ item: it, total: (linesByItem.get(it.id) ?? []).reduce((a, l) => a + Number(l.partial || 0), 0) }))
      .filter((r: any) => r.total > 0);

    const doc = h(Document, {}, [
      // === COVER / Carta de presentación ===
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

      // === ÍNDICE ===
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
        ].map((t, i) => h(Text, { key: i, style: styles.p }, t)),
        PageNumber(),
      ]),

      // === FICHA TÉCNICA ===
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

      // === MEMORIA VALORIZADA ===
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

      // === HOJA RESUMEN DE METRADOS ===
      h(Page, { key: "resumen-met", size: "A4", style: styles.page }, [
        Header({ project, period }),
        h(Text, { style: styles.h1 }, "HOJA RESUMEN DE METRADOS — PERÍODO"),
        h(View, { style: styles.row }, [
          h(Text, { style: [styles.th, { width: "12%" }] }, "Ítem"),
          h(Text, { style: [styles.th, { width: "58%" }] }, "Descripción"),
          h(Text, { style: [styles.th, { width: "10%" }] }, "Und."),
          h(Text, { style: [styles.th, { width: "20%" }] }, "Total"),
        ]),
        ...resumenMetrados.map((r: any, i: number) =>
          h(View, { key: i, style: styles.row }, [
            h(Text, { style: [styles.td, { width: "12%" }] }, r.item.item_code || "-"),
            h(Text, { style: [styles.td, { width: "58%" }] }, r.item.description),
            h(Text, { style: [styles.td, styles.tdCenter, { width: "10%" }] }, r.item.unit),
            h(Text, { style: [styles.td, styles.tdRight, { width: "20%" }] }, formatNum(r.total, 2)),
          ])
        ),
        PageNumber(),
      ]),

      // === PLANILLAS DETALLADAS POR PARTIDA ===
      h(Page, { key: "planillas", size: "A4", style: styles.page }, [
        Header({ project, period }),
        h(Text, { style: styles.h1 }, "PLANILLAS DE METRADOS POR PARTIDA"),
        ...Array.from(linesByItem.entries()).flatMap(([itemId, lines], idx) => {
          const it: any = itemMap.get(itemId);
          if (!it) return [];
          return [
            h(View, { key: `it-${idx}`, style: { marginTop: 8 } }, [
              h(Text, { style: styles.h2 }, `${it.item_code || ""}  ${it.description}  (${it.unit})`),
              h(View, { style: styles.row }, [
                h(Text, { style: [styles.th, { width: "20%" }] }, "Ubicación"),
                h(Text, { style: [styles.th, { width: "28%" }] }, "Descripción"),
                h(Text, { style: [styles.th, { width: "8%" }] }, "N°"),
                h(Text, { style: [styles.th, { width: "10%" }] }, "Largo"),
                h(Text, { style: [styles.th, { width: "10%" }] }, "Ancho"),
                h(Text, { style: [styles.th, { width: "10%" }] }, "Alto"),
                h(Text, { style: [styles.th, { width: "14%" }] }, "Parcial"),
              ]),
              ...lines.map((ln, li) => h(View, { key: li, style: styles.row }, [
                h(Text, { style: [styles.td, { width: "20%" }] }, [ln.group_label, ln.location_ref].filter(Boolean).join(" / ")),
                h(Text, { style: [styles.td, { width: "28%" }] }, ln.description || ""),
                h(Text, { style: [styles.td, styles.tdCenter, { width: "8%" }] }, formatNum(Number(ln.num_elements ?? 1), 2)),
                h(Text, { style: [styles.td, styles.tdRight, { width: "10%" }] }, ln.length != null ? formatNum(Number(ln.length), 2) : "-"),
                h(Text, { style: [styles.td, styles.tdRight, { width: "10%" }] }, ln.width != null ? formatNum(Number(ln.width), 2) : "-"),
                h(Text, { style: [styles.td, styles.tdRight, { width: "10%" }] }, ln.height != null ? formatNum(Number(ln.height), 2) : "-"),
                h(Text, { style: [styles.td, styles.tdRight, { width: "14%" }] }, formatNum(Number(ln.partial), 2)),
              ])),
            ]),
          ];
        }),
        PageNumber(),
      ]),

      // === CUADRO DE VALORIZACIÓN ===
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
        ...valTable.map((r, i) => h(View, { key: i, style: styles.row }, [
          h(Text, { style: [styles.td, { width: "6%" }] }, r.item.item_code || "-"),
          h(Text, { style: [styles.td, { width: "20%" }] }, r.item.description),
          h(Text, { style: [styles.td, styles.tdCenter, { width: "4%" }] }, r.item.unit),
          h(Text, { style: [styles.td, styles.tdRight, { width: "6%" }] }, formatNum(Number(r.item.base_quantity), 2)),
          h(Text, { style: [styles.td, styles.tdRight, { width: "7%" }] }, formatNum(Number(r.item.unit_price), 2)),
          h(Text, { style: [styles.td, styles.tdRight, { width: "8%" }] }, formatNum(Number(r.item.base_quantity) * Number(r.item.unit_price), 2)),
          h(Text, { style: [styles.td, styles.tdRight, { width: "7%" }] }, formatNum(r.qtyPrev, 2)),
          h(Text, { style: [styles.td, styles.tdRight, { width: "8%" }] }, formatNum(r.amountPrev, 2)),
          h(Text, { style: [styles.td, styles.tdRight, { width: "7%" }] }, formatNum(r.qtyCurrent, 2)),
          h(Text, { style: [styles.td, styles.tdRight, { width: "8%" }] }, formatNum(r.amountCurrent, 2)),
          h(Text, { style: [styles.td, styles.tdRight, { width: "7%" }] }, formatNum(r.qtyAccum, 2)),
          h(Text, { style: [styles.td, styles.tdRight, { width: "8%" }] }, formatNum(r.amountAccum, 2)),
          h(Text, { style: [styles.td, styles.tdRight, { width: "4%" }] }, formatNum(r.pctAccum, 1)),
        ])),
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

      // === RESUMEN DE VALORIZACIÓN + DEDUCCIONES ===
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
          : (deductions ?? []).map((d: any, i: number) => h(View, { key: i, style: styles.row }, [
              h(Text, { style: [styles.td, { width: "70%" }] }, `${deductionLabels[d.deduction_type]}${d.description ? ` — ${d.description}` : ""}`),
              h(Text, { style: [styles.td, styles.tdRight, { width: "30%" }] }, formatMoney(Number(d.amount), currency)),
            ]))),
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

    const blob = await pdf(doc as any).toBlob();
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const fileName = `expediente-${project.code}-val${String(period.period_number).padStart(2, "0")}-${Date.now()}.pdf`;
    const filePath = `${project.id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("expedientes")
      .upload(filePath, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new Error(`Error al subir PDF: ${uploadError.message}`);

    await supabase.from("expediente_documents").insert({
      project_id: project.id,
      period_id: period.id,
      file_path: filePath,
      file_name: fileName,
      total_valued: t.current,
      total_deductions: totalDeductions,
      net_amount: netAmount,
      generated_by: userId,
    });

    const { data: signed } = await supabase.storage
      .from("expedientes")
      .createSignedUrl(filePath, 60 * 60 * 24);

    return { fileName, filePath, signedUrl: signed?.signedUrl ?? null };
  });
