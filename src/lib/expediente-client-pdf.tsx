/* eslint-disable react-refresh/only-export-components */
import type { BudgetItemRow, ProjectRow } from "@/lib/domain";
import {
  buildSummaryHierarchy,
  deductionLabels,
  formatMoney,
  formatNum,
  type DeductionLine,
  type MetradoLine,
  type ValuationItemSummary,
} from "@/lib/expediente";
import { BREAKDOWN_ROWS, type ValuationBreakdown } from "@/lib/valuation-breakdown";

type PeriodLike = {
  id: string;
  period_number: number;
  date_from: string;
  date_to: string;
  generalidades: string | null;
  metas: string | null;
  ocurrencias: string | null;
  conclusiones: string | null;
};

type TotalsLike = { base: number; prev: number; current: number; accum: number; balance: number };

export type PrevValuationLike = {
  period_number: number;
  period_month: string;
  gross_amount: number;
  net_amount: number;
};

type GenerateArgs = {
  project: ProjectRow;
  period: PeriodLike;
  items: BudgetItemRow[];
  currentLines: MetradoLine[];
  deductions: DeductionLine[];
  valTable: ValuationItemSummary[];
  totals: TotalsLike;
  totalDeductions: number;
  netAmount: number;
  currency: string;
  /** Hoja de Valorización A–Q ya calculada (opcional). */
  breakdown?: ValuationBreakdown | null;
  /** Factor polinómico K aplicado al período (opcional). */
  reajusteK?: number | null;
  /** Valorizaciones anteriores del proyecto (para resumen general de pagos). */
  previousValuations?: PrevValuationLike[];
};

function clean(value: unknown) {
  const v = String(value ?? "").replace(/\s+/g, " ").trim();
  return v || "—";
}
function formatLocation(p: ProjectRow) {
  return [p.location, p.district, p.province, p.department].filter(Boolean).join(", ") || "—";
}

function validateExpedienteData(args: GenerateArgs) {
  const missing: string[] = [];
  const required: Array<[keyof ProjectRow, string]> = [
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
  for (const [k, label] of required) {
    const v = args.project[k];
    if (v == null || v === "" || v === 0) missing.push(`Ficha técnica → ${label}`);
  }
  if (!args.project.contract_amount || Number(args.project.contract_amount) <= 0)
    missing.push("Ficha técnica → Monto contractual");
  if (args.items.length === 0) missing.push("Presupuesto → No hay partidas registradas");
  if (args.totals.current <= 0) missing.push("Valorización → Los metrados no generan valorización > 0");
  if (missing.length > 0) {
    throw new Error("Falta información para generar la memoria e informe técnico:\n• " + missing.join("\n• "));
  }
}

export async function generateExpedienteClientPdf(args: GenerateArgs) {
  validateExpedienteData(args);

  const { Document, Page, Text, View, StyleSheet, pdf } = await import("@react-pdf/renderer");
  const React = await import("react");
  const { createElement: h, Fragment } = React;

  const COLORS = {
    border: "#9ca3af",
    borderLight: "#d1d5db",
    headerBg: "#e5e7eb",
    text: "#111827",
    muted: "#6b7280",
    accent: "#1e3a8a",
  };

  const styles = StyleSheet.create({
    page: { paddingTop: 40, paddingBottom: 50, paddingHorizontal: 32, fontSize: 9, fontFamily: "Helvetica", color: COLORS.text },
    pageLandscape: { paddingTop: 40, paddingBottom: 50, paddingHorizontal: 24, fontSize: 8, fontFamily: "Helvetica", color: COLORS.text },
    header: {
      position: "absolute", top: 16, left: 32, right: 32,
      fontSize: 7, color: COLORS.muted, borderBottomWidth: 0.5, borderBottomColor: COLORS.borderLight, paddingBottom: 4,
      flexDirection: "row", justifyContent: "space-between",
    },
    footer: { position: "absolute", bottom: 20, left: 32, right: 32, fontSize: 7, color: COLORS.muted, textAlign: "right" },
    h1: { fontSize: 14, fontFamily: "Helvetica-Bold", color: COLORS.accent, marginBottom: 2 },
    h1Rule: { borderBottomWidth: 1, borderBottomColor: COLORS.accent, marginBottom: 10 },
    h2: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 4 },
    p: { fontSize: 9, lineHeight: 1.4, marginBottom: 4 },
    coverTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 180, color: COLORS.accent },
    coverSub: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 6, color: COLORS.accent },
    coverProject: { fontSize: 12, textAlign: "center", marginTop: 30 },
    coverLine: { fontSize: 10, textAlign: "center", marginTop: 6 },
    fichaRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COLORS.borderLight, paddingVertical: 4 },
    fichaLabel: { width: 150, fontFamily: "Helvetica-Bold", fontSize: 9 },
    fichaValue: { flex: 1, fontSize: 9 },
    table: { borderWidth: 0.5, borderColor: COLORS.border, marginTop: 4, marginBottom: 8 },
    thRow: { flexDirection: "row", backgroundColor: COLORS.headerBg, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
    th: { padding: 4, fontFamily: "Helvetica-Bold", fontSize: 7.5, borderRightWidth: 0.5, borderRightColor: COLORS.border },
    tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COLORS.borderLight },
    trLast: { flexDirection: "row" },
    td: { padding: 3.5, fontSize: 7.5, borderRightWidth: 0.5, borderRightColor: COLORS.borderLight },
    totalRow: { flexDirection: "row", backgroundColor: "#f3f4f6", borderTopWidth: 0.5, borderTopColor: COLORS.border },
    totalCell: { padding: 4, fontSize: 8, fontFamily: "Helvetica-Bold", borderRightWidth: 0.5, borderRightColor: COLORS.borderLight },
    sigBox: { marginTop: 60, flexDirection: "row", justifyContent: "space-around" },
    sigLine: { borderTopWidth: 0.5, borderTopColor: COLORS.text, width: 180, paddingTop: 4, textAlign: "center", fontSize: 9 },
  });

  const { project, period, currency, valTable, deductions, totals: t, totalDeductions, netAmount } = args;
  const headerLabel = `${clean(project.name)}  |  Valorización N° ${String(period.period_number).padStart(2, "0")}  |  ${period.date_from} a ${period.date_to}`;

  type Col = { key: string; label: string; width: number; align?: "left" | "right" | "center" };

  function Table(props: { cols: Col[]; rows: Array<Record<string, string>>; totalRow?: Record<string, string> }) {
    const { cols, rows, totalRow } = props;
    return h(View, { style: styles.table, wrap: true } as any,
      // header
      h(View, { style: styles.thRow, fixed: true } as any,
        ...cols.map((c, i) =>
          h(Text, {
            key: `h-${c.key}`,
            style: [styles.th, { width: c.width, textAlign: c.align ?? "left", borderRightWidth: i === cols.length - 1 ? 0 : 0.5 }] as any,
          } as any, c.label)
        )
      ),
      // body
      ...rows.map((r, ri) =>
        h(View, { key: `r-${ri}`, style: ri === rows.length - 1 && !totalRow ? styles.trLast : styles.tr, wrap: false } as any,
          ...cols.map((c, i) =>
            h(Text, {
              key: `c-${ri}-${c.key}`,
              style: [styles.td, { width: c.width, textAlign: c.align ?? "left", borderRightWidth: i === cols.length - 1 ? 0 : 0.5 }] as any,
            } as any, r[c.key] ?? "—")
          )
        )
      ),
      totalRow
        ? h(View, { style: styles.totalRow, wrap: false } as any,
            ...cols.map((c, i) =>
              h(Text, {
                key: `t-${c.key}`,
                style: [styles.totalCell, { width: c.width, textAlign: c.align ?? "left", borderRightWidth: i === cols.length - 1 ? 0 : 0.5 }] as any,
              } as any, totalRow[c.key] ?? "")
            )
          )
        : null,
    );
  }

  function PageHeader() {
    return h(Fragment, null,
      h(View, { style: styles.header, fixed: true } as any,
        h(Text, null, headerLabel),
      ),
      h(Text, {
        style: styles.footer, fixed: true,
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Pág. ${pageNumber} / ${totalPages}`,
      } as any),
    );
  }

  function FichaRow(props: { label: string; value: string }) {
    return h(View, { style: styles.fichaRow } as any,
      h(Text, { style: styles.fichaLabel } as any, props.label),
      h(Text, { style: styles.fichaValue } as any, clean(props.value)),
    );
  }

  // ---------- Page 1: Cover ----------
  const Cover = h(Page, { size: "A4", style: styles.page } as any,
    h(Text, { style: styles.coverTitle } as any, "MEMORIA VALORIZADA"),
    h(Text, { style: styles.coverSub } as any, "E INFORME TÉCNICO"),
    h(Text, { style: styles.coverProject } as any, clean(project.name)),
    h(Text, { style: styles.coverLine } as any, `Valorización N° ${String(period.period_number).padStart(2, "0")}`),
    h(Text, { style: styles.coverLine } as any, `Periodo: ${period.date_from} a ${period.date_to}`),
    h(Text, { style: [styles.coverLine, { marginTop: 16 }] } as any, `Entidad: ${clean(project.entity_name)}`),
    h(Text, { style: styles.coverLine } as any, `Contratista: ${clean(project.contractor_name)}`),
  );

  // ---------- Page 2: Index ----------
  const Index = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "ÍNDICE"),
    h(View, { style: styles.h1Rule } as any),
    ...[
      "1. Ficha técnica de obra",
      "2. Generalidades y control administrativo",
      "3. Incidencias y conclusiones",
      "4. Planilla de metrados (Contratado · Acum. anterior · Mes · Acum. actual · Saldo · %)",
      "5. Hoja resumen de metrados",
      "6. Hoja de valorización (A–Q)",
      "7. Resumen general de pagos",
      "8. Resumen económico y deducciones",
    ].map((t, i) => h(Text, { key: i, style: styles.p } as any, t)),
  );

  // ---------- Page 3: Ficha técnica ----------
  const Ficha = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "1. FICHA TÉCNICA DE OBRA"),
    h(View, { style: styles.h1Rule } as any),
    FichaRow({ label: "Nombre de la obra", value: project.name }),
    FichaRow({ label: "Código", value: project.code }),
    FichaRow({ label: "Entidad", value: project.entity_name || "" }),
    FichaRow({ label: "Unidad ejecutora", value: project.executing_unit || "" }),
    FichaRow({ label: "Contratista", value: project.contractor_name || "" }),
    FichaRow({ label: "Modalidad de ejecución", value: project.execution_modality || "" }),
    FichaRow({ label: "Contrato de ejecución", value: project.execution_contract || "" }),
    FichaRow({ label: "Contrato de supervisión", value: project.supervision_contract || "" }),
    FichaRow({ label: "Residente de obra", value: project.resident_name || "" }),
    FichaRow({ label: "Supervisor", value: project.supervisor_name || "" }),
    FichaRow({ label: "Ubicación", value: formatLocation(project) }),
    FichaRow({ label: "Fecha de inicio", value: project.start_date || "" }),
    FichaRow({ label: "Plazo de ejecución", value: `${project.execution_term_days || "—"} días` }),
    FichaRow({ label: "Fecha de término", value: project.planned_completion_date || project.planned_end_date || "" }),
    FichaRow({ label: "Estado", value: project.status }),
    h(Text, { style: styles.h2 } as any, "Presupuesto de obra"),
    FichaRow({ label: "Costo directo", value: formatMoney(Number(project.direct_cost || 0), currency) }),
    FichaRow({ label: "Gastos generales", value: formatMoney(Number(project.overhead_cost || 0), currency) }),
    FichaRow({ label: "Utilidad", value: formatMoney(Number(project.utility_amount || 0), currency) }),
    FichaRow({ label: "IGV", value: formatMoney(Number(project.igv_amount || 0), currency) }),
    FichaRow({ label: "Monto contractual", value: formatMoney(Number(project.contract_amount || 0), currency) }),
  );

  // ---------- Page 4: Memoria (Generalidades, control admin, incidencias, conclusiones) ----------
  const Memoria = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "2. GENERALIDADES Y CONTROL ADMINISTRATIVO"),
    h(View, { style: styles.h1Rule } as any),
    h(Text, { style: styles.h2 } as any, "2.1 Generalidades"),
    h(Text, { style: styles.p } as any, clean(period.generalidades)),
    h(Text, { style: styles.h2 } as any, "2.2 Ubicación de la obra"),
    h(Text, { style: styles.p } as any, formatLocation(project)),
    h(Text, { style: styles.h2 } as any, "2.3 Metas del proyecto"),
    h(Text, { style: styles.p } as any, clean(period.metas)),
    h(Text, { style: styles.h2 } as any, "2.4 Control administrativo del período"),
    h(Text, { style: styles.p } as any, `Período: ${period.date_from} al ${period.date_to}`),
    h(Text, { style: styles.p } as any, `Valorización N° ${String(period.period_number).padStart(2, "0")}`),
    h(Text, { style: styles.p } as any, `Residente: ${clean(project.resident_name)}  ·  Supervisor: ${clean(project.supervisor_name)}`),
    h(Text, { style: [styles.h1, { marginTop: 16 }] } as any, "3. INCIDENCIAS Y CONCLUSIONES"),
    h(View, { style: styles.h1Rule } as any),
    h(Text, { style: styles.h2 } as any, "3.1 Incidencias / Ocurrencias"),
    h(Text, { style: styles.p } as any, clean(period.ocurrencias)),
    h(Text, { style: styles.h2 } as any, "3.2 Conclusiones"),
    h(Text, { style: styles.p } as any, clean(period.conclusiones)),
  );

  // ---------- Page 5: Planilla de metrados (landscape) ----------
  // A4 landscape: 842 x 595 pt; available ≈ 842 - 48 = 794 pt.
  const planillaCols: Col[] = [
    { key: "code", label: "Ítem", width: 60 },
    { key: "desc", label: "Descripción", width: 250 },
    { key: "und", label: "Und.", width: 40, align: "center" },
    { key: "base", label: "Contratado", width: 70, align: "right" },
    { key: "prev", label: "Acum. anterior", width: 80, align: "right" },
    { key: "mes", label: "Mes actual", width: 70, align: "right" },
    { key: "acum", label: "Acum. actual", width: 80, align: "right" },
    { key: "saldo", label: "Saldo", width: 70, align: "right" },
    { key: "pct", label: "% Ejec.", width: 74, align: "right" },
  ];
  const planillaRows = valTable
    .filter((r) => r.qtyAccum > 0 || r.qtyCurrent > 0 || Number(r.item.base_quantity || 0) > 0)
    .map((r) => ({
      code: r.item.item_code ?? "",
      desc: r.item.description ?? "",
      und: r.item.unit ?? "",
      base: formatNum(Number(r.item.base_quantity || 0), 2),
      prev: formatNum(r.qtyPrev, 2),
      mes: formatNum(r.qtyCurrent, 2),
      acum: formatNum(r.qtyAccum, 2),
      saldo: formatNum(r.qtyBalance, 2),
      pct: `${formatNum(r.pctAccum, 2)}%`,
    }));

  const PlanillaPage = h(Page, { size: "A4", orientation: "landscape", style: styles.pageLandscape } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "4. PLANILLA DE METRADOS"),
    h(View, { style: styles.h1Rule } as any),
    planillaRows.length === 0
      ? h(Text, { style: styles.p } as any, "Sin partidas con metrado para mostrar.")
      : Table({ cols: planillaCols, rows: planillaRows }),
  );

  // ---------- Page 6: Hoja resumen de metrados (portrait) ----------
  // Available width portrait A4 ≈ 595 - 64 = 531 pt. We'll work in pt.
  const resumenCols: Col[] = [
    { key: "code", label: "Ítem", width: 70 },
    { key: "desc", label: "Descripción", width: 305 },
    { key: "und", label: "Und.", width: 50, align: "center" },
    { key: "qty", label: "TOTAL", width: 106, align: "right" },
  ];
  const hierarchy = buildSummaryHierarchy(valTable);
  const resumenRows = hierarchy.map((r) => ({
    code: r.code,
    // Indentación visual con espacios no separables
    desc: `${"\u00A0\u00A0".repeat(r.level)}${r.description || ""}`,
    und: r.isLeaf ? r.unit : "",
    qty: r.isLeaf && r.total != null ? formatNum(r.total, 2) : "",
  }));

  const ResumenPage = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "5. HOJA RESUMEN DE METRADOS"),
    h(View, { style: styles.h1Rule } as any),
    resumenRows.length === 0
      ? h(Text, { style: styles.p } as any, "Sin metrados registrados para el período.")
      : Table({ cols: resumenCols, rows: resumenRows }),
  );

  // ---------- Page 7: Hoja de valorización A–Q ----------
  const bk = args.breakdown ?? null;
  const aqCols: Col[] = [
    { key: "letter", label: "", width: 40, align: "center" },
    { key: "label", label: "Concepto", width: 371 },
    { key: "amount", label: "Monto", width: 120, align: "right" },
  ];
  const aqRows = bk
    ? BREAKDOWN_ROWS.map((row) => ({
        letter: row.letter,
        label: row.label,
        amount: formatMoney(Number((bk as any)[row.key] ?? 0), currency),
      }))
    : [];

  const HojaAQ = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "6. HOJA DE VALORIZACIÓN (A–Q)"),
    h(View, { style: styles.h1Rule } as any),
    h(Text, { style: styles.p } as any,
      `Valorización N° ${String(period.period_number).padStart(2, "0")}  ·  ` +
      `Período ${period.date_from} a ${period.date_to}` +
      (args.reajusteK != null ? `  ·  K = ${Number(args.reajusteK).toFixed(4)}` : ""),
    ),
    bk
      ? Table({ cols: aqCols, rows: aqRows })
      : h(Text, { style: styles.p } as any,
          "Hoja A–Q no disponible. Configura % Gastos generales, % Utilidad, retención y adelantos en el proyecto y crea la valorización del mes para que se calcule automáticamente."),
  );

  // ---------- Page 8: Resumen general de pagos ----------
  const prev = (args.previousValuations ?? []).slice().sort((a, b) => a.period_number - b.period_number);
  const contractAmount = Number(project.contract_amount || 0);
  const sumPrevGross = prev.reduce((s, v) => s + Number(v.gross_amount || 0), 0);
  const sumPrevNet = prev.reduce((s, v) => s + Number(v.net_amount || 0), 0);
  const currentGross = bk ? bk.subtotalReajustado : t.current;
  const currentNet = bk ? bk.netToContractor : netAmount;
  const accumGross = sumPrevGross + currentGross;
  const accumNet = sumPrevNet + currentNet;
  const balanceContract = Math.max(contractAmount - accumGross, 0);

  const pagosCols: Col[] = [
    { key: "n", label: "Val. N°", width: 60, align: "center" },
    { key: "mes", label: "Período", width: 100, align: "center" },
    { key: "bruto", label: "Bruto", width: 180, align: "right" },
    { key: "neto", label: "Neto pagado", width: 191, align: "right" },
  ];
  const pagosRows = [
    ...prev.map((v) => ({
      n: String(v.period_number).padStart(2, "0"),
      mes: v.period_month?.slice(0, 7) ?? "—",
      bruto: formatMoney(Number(v.gross_amount || 0), currency),
      neto: formatMoney(Number(v.net_amount || 0), currency),
    })),
    {
      n: String(period.period_number).padStart(2, "0"),
      mes: period.date_from.slice(0, 7),
      bruto: formatMoney(currentGross, currency),
      neto: formatMoney(currentNet, currency),
    },
  ];

  const ResumenPagos = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "7. RESUMEN GENERAL DE PAGOS"),
    h(View, { style: styles.h1Rule } as any),
    FichaRow({ label: "Monto contractual", value: formatMoney(contractAmount, currency) }),
    FichaRow({ label: "Acumulado anterior (bruto)", value: formatMoney(sumPrevGross, currency) }),
    FichaRow({ label: "Valorización presente (bruto)", value: formatMoney(currentGross, currency) }),
    FichaRow({ label: "Acumulado actual (bruto)", value: formatMoney(accumGross, currency) }),
    FichaRow({ label: "Saldo por valorizar", value: formatMoney(balanceContract, currency) }),
    FichaRow({ label: "% Avance contractual acumulado", value: contractAmount > 0 ? `${formatNum((accumGross / contractAmount) * 100, 2)}%` : "—" }),
    h(Text, { style: styles.h2 } as any, "Detalle por valorización"),
    Table({
      cols: pagosCols,
      rows: pagosRows,
      totalRow: {
        n: "",
        mes: "TOTAL",
        bruto: formatMoney(accumGross, currency),
        neto: formatMoney(accumNet, currency),
      },
    }),
  );

  // ---------- Page 9: Resumen y deducciones ----------
  const dedCols: Col[] = [
    { key: "concepto", label: "Concepto", width: 380 },
    { key: "monto", label: "Monto", width: 151, align: "right" },
  ];
  const dedRows = deductions.length === 0
    ? [{ concepto: "Sin deducciones registradas", monto: formatMoney(0, currency) }]
    : deductions.map((d) => ({
        concepto: `${deductionLabels[d.deduction_type]}${d.description ? ` — ${d.description}` : ""}`,
        monto: formatMoney(Number(d.amount), currency),
      }));

  const ResumenFinalPage = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "8. RESUMEN ECONÓMICO Y DEDUCCIONES"),
    h(View, { style: styles.h1Rule } as any),
    FichaRow({ label: "Monto contractual", value: formatMoney(Number(project.contract_amount || 0), currency) }),
    FichaRow({ label: "Acumulado anterior", value: formatMoney(t.prev, currency) }),
    FichaRow({ label: "Valorización del período", value: formatMoney(t.current, currency) }),
    FichaRow({ label: "Acumulado a la fecha", value: formatMoney(t.accum, currency) }),
    FichaRow({ label: "Saldo por valorizar", value: formatMoney(t.balance, currency) }),
    h(Text, { style: styles.h2 } as any, "Deducciones"),
    Table({
      cols: dedCols,
      rows: dedRows,
      totalRow: { concepto: "TOTAL DEDUCCIONES", monto: formatMoney(totalDeductions, currency) },
    }),
    h(View, { style: { marginTop: 8, borderTopWidth: 1, borderTopColor: COLORS.accent, paddingTop: 6 } } as any,
      h(View, { style: { flexDirection: "row", justifyContent: "space-between" } } as any,
        h(Text, { style: { fontFamily: "Helvetica-Bold", fontSize: 11 } } as any, "MONTO NETO A PAGAR"),
        h(Text, { style: { fontFamily: "Helvetica-Bold", fontSize: 11 } } as any,
          formatMoney(bk ? bk.netToPay : netAmount, currency)),
      ),
    ),
    h(View, { style: styles.sigBox } as any,
      h(Text, { style: styles.sigLine } as any, project.resident_name || "Residente de Obra"),
      h(Text, { style: styles.sigLine } as any, project.supervisor_name || "Supervisor"),
    ),
  );

  const doc = h(Document, null, Cover, Index, Ficha, Memoria, PlanillaPage, ResumenPage, HojaAQ, ResumenPagos, ResumenFinalPage);
  const blob = await pdf(doc as any).toBlob();
  const safeCode = clean(project.code).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const fileName = `memoria-informe-${safeCode}-val${String(period.period_number).padStart(2, "0")}.pdf`;
  const url = URL.createObjectURL(blob);
  return { fileName, url, blob };
}
