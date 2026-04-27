/* eslint-disable react-refresh/only-export-components */
import type { BudgetItemRow, ProjectRow } from "@/lib/domain";
import {
  deductionLabels,
  formatMoney,
  formatNum,
  type DeductionLine,
  type MetradoLine,
  type ValuationItemSummary,
} from "@/lib/expediente";

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
      "2. Memoria valorizada e informe técnico",
      "3. Resumen consolidado de metrados",
      "4. Resumen económico y deducciones",
    ].map((t, i) => h(Text, { key: i, style: styles.p } as any, t)),
  );

  // ---------- Page 3: Ficha técnica ----------
  const Ficha = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "FICHA TÉCNICA DE OBRA"),
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

  // ---------- Page 4: Memoria ----------
  const Memoria = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "MEMORIA VALORIZADA E INFORME TÉCNICO"),
    h(View, { style: styles.h1Rule } as any),
    h(Text, { style: styles.h2 } as any, "1. Generalidades"),
    h(Text, { style: styles.p } as any, clean(period.generalidades)),
    h(Text, { style: styles.h2 } as any, "2. Ubicación"),
    h(Text, { style: styles.p } as any, formatLocation(project)),
    h(Text, { style: styles.h2 } as any, "3. Metas del proyecto"),
    h(Text, { style: styles.p } as any, clean(period.metas)),
    h(Text, { style: styles.h2 } as any, "4. Resumen de avances"),
    h(Text, { style: styles.p } as any, `Acumulado anterior: ${formatMoney(t.prev, currency)}`),
    h(Text, { style: styles.p } as any, `Valorización del período: ${formatMoney(t.current, currency)}`),
    h(Text, { style: styles.p } as any, `Acumulado a la fecha: ${formatMoney(t.accum, currency)}`),
    h(Text, { style: styles.p } as any, `Saldo por valorizar: ${formatMoney(t.balance, currency)}`),
    h(Text, { style: styles.h2 } as any, "5. Ocurrencias"),
    h(Text, { style: styles.p } as any, clean(period.ocurrencias)),
    h(Text, { style: styles.h2 } as any, "6. Conclusiones"),
    h(Text, { style: styles.p } as any, clean(period.conclusiones)),
  );

  // ---------- Page 5: Hoja resumen de metrados (portrait) ----------
  // Available width portrait A4 ≈ 595 - 64 = 531 pt. We'll work in pt.
  const resumenCols: Col[] = [
    { key: "code", label: "Ítem", width: 55 },
    { key: "desc", label: "Descripción", width: 320 },
    { key: "und", label: "Und.", width: 50, align: "center" },
    { key: "qty", label: "Metrado actual", width: 106, align: "right" },
  ];
  const resumenRows = valTable
    .filter((r) => r.qtyCurrent > 0)
    .map((r) => ({
      code: r.item.item_code || "—",
      desc: r.item.description,
      und: r.item.unit,
      qty: formatNum(r.qtyCurrent, 2),
    }));

  const ResumenPage = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "HOJA RESUMEN DE METRADOS"),
    h(View, { style: styles.h1Rule } as any),
    resumenRows.length === 0
      ? h(Text, { style: styles.p } as any, "Sin metrados registrados para el período.")
      : Table({ cols: resumenCols, rows: resumenRows }),
  );

  // ---------- Page 6: Planillas por partida (portrait) ----------
  const planillaCols: Col[] = [
    { key: "loc", label: "Ubicación", width: 90 },
    { key: "desc", label: "Descripción", width: 145 },
    { key: "n", label: "N°", width: 38, align: "right" },
    { key: "l", label: "Largo", width: 48, align: "right" },
    { key: "a", label: "Ancho", width: 48, align: "right" },
    { key: "h", label: "Alto", width: 48, align: "right" },
    { key: "p", label: "Parcial", width: 60, align: "right" },
  ]; // sum: 477 — fits portrait content width (~531)

  const itemById = new Map(items.map((it) => [it.id, it]));
  const linesByItem = new Map<string, MetradoLine[]>();
  for (const line of currentLines) {
    const list = linesByItem.get(line.item_id) ?? [];
    list.push(line);
    linesByItem.set(line.item_id, list);
  }

  const planillaSections: any[] = [];
  for (const [itemId, lines] of linesByItem.entries()) {
    const it = itemById.get(itemId);
    if (!it) continue;
    const subtotal = lines.reduce((s, l) => s + Number(l.partial || 0), 0);
    const rows = lines.map((l) => ({
      loc: [l.group_label, l.location_ref].filter(Boolean).join(" / ") || "—",
      desc: l.description || "—",
      n: formatNum(Number(l.num_elements ?? 1), 2),
      l: l.length != null ? formatNum(Number(l.length), 2) : "—",
      a: l.width != null ? formatNum(Number(l.width), 2) : "—",
      h: l.height != null ? formatNum(Number(l.height), 2) : "—",
      p: formatNum(Number(l.partial), 2),
    }));
    planillaSections.push(
      h(View, { key: `pl-${itemId}`, wrap: true, style: { marginBottom: 10 } } as any,
        h(Text, { style: styles.h2 } as any, `${it.item_code || ""} ${it.description}  (${it.unit})`),
        Table({
          cols: planillaCols,
          rows,
          totalRow: { loc: "", desc: "", n: "", l: "", a: "", h: "TOTAL", p: formatNum(subtotal, 2) },
        }),
      )
    );
  }

  const PlanillasPage = h(Page, { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "PLANILLAS DE METRADOS POR PARTIDA"),
    h(View, { style: styles.h1Rule } as any),
    ...(planillaSections.length === 0
      ? [h(Text, { style: styles.p, key: "empty" } as any, "Sin planillas registradas.")]
      : planillaSections),
  );

  // ---------- Page 7: Cuadro de valorización (landscape) ----------
  // Landscape A4 content ≈ 842 - 48 = 794 pt
  const valCols: Col[] = [
    { key: "code", label: "Ítem", width: 50 },
    { key: "desc", label: "Descripción", width: 220 },
    { key: "und", label: "Und.", width: 36, align: "center" },
    { key: "meta", label: "Meta", width: 55, align: "right" },
    { key: "ant", label: "Ant.", width: 55, align: "right" },
    { key: "act", label: "Actual", width: 55, align: "right" },
    { key: "acu", label: "Acum.", width: 55, align: "right" },
    { key: "amt", label: "Monto actual", width: 90, align: "right" },
    { key: "pct", label: "% acum.", width: 50, align: "right" },
    { key: "sal", label: "Saldo", width: 55, align: "right" },
  ]; // sum = 721 pt
  const valRows = valTable.map((r) => ({
    code: r.item.item_code || "—",
    desc: r.item.description,
    und: r.item.unit,
    meta: formatNum(Number(r.item.base_quantity), 2),
    ant: formatNum(r.qtyPrev, 2),
    act: formatNum(r.qtyCurrent, 2),
    acu: formatNum(r.qtyAccum, 2),
    amt: formatMoney(r.amountCurrent, currency),
    pct: `${formatNum(r.pctAccum, 1)}%`,
    sal: formatNum(r.qtyBalance, 2),
  }));
  const valTotal = {
    code: "", desc: "TOTALES", und: "", meta: "", ant: formatMoney(t.prev, currency),
    act: formatMoney(t.current, currency), acu: formatMoney(t.accum, currency),
    amt: formatMoney(t.current, currency), pct: "", sal: formatMoney(t.balance, currency),
  };

  const CuadroPage = h(Page, { size: "A4", orientation: "landscape", style: styles.pageLandscape } as any,
    h(View, { style: [styles.header, { left: 24, right: 24 }] as any, fixed: true } as any,
      h(Text, null, headerLabel),
    ),
    h(Text, {
      style: [styles.footer, { left: 24, right: 24 }] as any, fixed: true,
      render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Pág. ${pageNumber} / ${totalPages}`,
    } as any),
    h(Text, { style: styles.h1 } as any, "CUADRO DE VALORIZACIÓN DE OBRA"),
    h(View, { style: styles.h1Rule } as any),
    Table({ cols: valCols, rows: valRows, totalRow: valTotal }),
  );

  // ---------- Page 8: Resumen y deducciones ----------
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
    h(Text, { style: styles.h1 } as any, "RESUMEN DE VALORIZACIÓN Y DEDUCCIONES"),
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
        h(Text, { style: { fontFamily: "Helvetica-Bold", fontSize: 11 } } as any, formatMoney(netAmount, currency)),
      ),
    ),
    h(View, { style: styles.sigBox } as any,
      h(Text, { style: styles.sigLine } as any, project.resident_name || "Residente de Obra"),
      h(Text, { style: styles.sigLine } as any, project.supervisor_name || "Supervisor"),
    ),
  );

  const doc = h(Document, null, Cover, Index, Ficha, Memoria, ResumenPage, PlanillasPage, CuadroPage, ResumenFinalPage);
  const blob = await pdf(doc as any).toBlob();
  const safeCode = clean(project.code).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const fileName = `expediente-${safeCode}-val${String(period.period_number).padStart(2, "0")}.pdf`;
  const url = URL.createObjectURL(blob);
  return { fileName, url, blob };
}
