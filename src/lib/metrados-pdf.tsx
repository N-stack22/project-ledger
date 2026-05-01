/* eslint-disable react-refresh/only-export-components */
import type { BudgetItemRow, ProjectRow } from "@/lib/domain";
import {
  buildSummaryHierarchy,
  buildValuationTable,
  formatNum,
  type MetradoLine,
} from "@/lib/expediente";

type PeriodLike = {
  id: string;
  period_number: number;
  date_from: string;
  date_to: string;
};

type GenerateMetradosPdfArgs = {
  project: ProjectRow;
  period: PeriodLike;
  items: BudgetItemRow[];
  currentLines: MetradoLine[];
  previousLines?: MetradoLine[];
};

function clean(value: unknown) {
  const v = String(value ?? "").replace(/\s+/g, " ").trim();
  return v || "—";
}

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) === 0) return "";
  return formatNum(Number(n), d);
}

/**
 * Genera el PDF "Metrados de partidas ejecutadas" con dos secciones:
 *   1) Hoja Resumen de Metrados (jerárquica, hasta el período seleccionado)
 *   2) Planillas de metrados por partida ejecutada (detalle línea por línea)
 */
export async function generateMetradosPdf(args: GenerateMetradosPdfArgs) {
  const { Document, Page, Text, View, StyleSheet, pdf } = await import("@react-pdf/renderer");
  const React = await import("react");
  const { createElement: h, Fragment } = React;

  const { project, period, items, currentLines, previousLines = [] } = args;

  const COLORS = {
    border: "#9ca3af",
    borderLight: "#d1d5db",
    headerBg: "#e5e7eb",
    rowAlt: "#f9fafb",
    text: "#111827",
    muted: "#6b7280",
    accent: "#1e3a8a",
  };

  const styles = StyleSheet.create({
    page: {
      paddingTop: 44,
      paddingBottom: 50,
      paddingHorizontal: 28,
      fontSize: 8.5,
      fontFamily: "Helvetica",
      color: COLORS.text,
    },
    header: {
      position: "absolute",
      top: 16,
      left: 28,
      right: 28,
      fontSize: 7,
      color: COLORS.muted,
      borderBottomWidth: 0.5,
      borderBottomColor: COLORS.borderLight,
      paddingBottom: 4,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    footer: {
      position: "absolute",
      bottom: 20,
      left: 28,
      right: 28,
      fontSize: 7,
      color: COLORS.muted,
      textAlign: "right",
    },
    h1: { fontSize: 13, fontFamily: "Helvetica-Bold", color: COLORS.accent, marginBottom: 2 },
    h1Rule: { borderBottomWidth: 1, borderBottomColor: COLORS.accent, marginBottom: 8 },
    h2: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 4 },
    p: { fontSize: 9, lineHeight: 1.4, marginBottom: 4 },
    table: { borderWidth: 0.5, borderColor: COLORS.border, marginTop: 4, marginBottom: 8 },
    thRow: {
      flexDirection: "row",
      backgroundColor: COLORS.headerBg,
      borderBottomWidth: 0.5,
      borderBottomColor: COLORS.border,
    },
    thRowDouble: {
      flexDirection: "row",
      backgroundColor: COLORS.headerBg,
      borderBottomWidth: 0.5,
      borderBottomColor: COLORS.border,
    },
    th: {
      padding: 3,
      fontFamily: "Helvetica-Bold",
      fontSize: 7.5,
      borderRightWidth: 0.5,
      borderRightColor: COLORS.border,
    },
    tr: {
      flexDirection: "row",
      borderBottomWidth: 0.5,
      borderBottomColor: COLORS.borderLight,
    },
    trAlt: {
      flexDirection: "row",
      borderBottomWidth: 0.5,
      borderBottomColor: COLORS.borderLight,
      backgroundColor: COLORS.rowAlt,
    },
    td: {
      padding: 3,
      fontSize: 7.5,
      borderRightWidth: 0.5,
      borderRightColor: COLORS.borderLight,
    },
    parentRow: {
      flexDirection: "row",
      backgroundColor: "#eef2ff",
      borderBottomWidth: 0.5,
      borderBottomColor: COLORS.border,
    },
    parentCell: {
      padding: 3,
      fontSize: 7.5,
      fontFamily: "Helvetica-Bold",
      borderRightWidth: 0.5,
      borderRightColor: COLORS.border,
    },
    totalRow: {
      flexDirection: "row",
      backgroundColor: "#f3f4f6",
      borderTopWidth: 0.5,
      borderTopColor: COLORS.border,
    },
    totalCell: {
      padding: 4,
      fontSize: 8,
      fontFamily: "Helvetica-Bold",
      borderRightWidth: 0.5,
      borderRightColor: COLORS.borderLight,
    },
    partidaHeader: {
      marginTop: 8,
      marginBottom: 2,
      paddingVertical: 4,
      paddingHorizontal: 6,
      backgroundColor: "#eef2ff",
      borderLeftWidth: 3,
      borderLeftColor: COLORS.accent,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    partidaCode: { fontSize: 9, fontFamily: "Helvetica-Bold", color: COLORS.accent },
    partidaDesc: { fontSize: 9, fontFamily: "Helvetica-Bold" },
    partidaMeta: { fontSize: 7.5, color: COLORS.muted },
  });

  const headerLabel = `${clean(project.name)}  |  Valorización N° ${String(period.period_number).padStart(2, "0")}  |  ${period.date_from} a ${period.date_to}`;

  function PageHeader() {
    return h(
      Fragment,
      null,
      h(View, { style: styles.header, fixed: true } as any, h(Text, null, headerLabel)),
      h(Text, {
        style: styles.footer,
        fixed: true,
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `Pág. ${pageNumber} / ${totalPages}`,
      } as any),
    );
  }

  // ============================================================
  // Sección 1: HOJA RESUMEN DE METRADOS
  // ============================================================
  // Columnas (suma de anchos = 539 pt aprox para A4 portrait con padding 28):
  // Ítem 60 | Descripción 230 | Und 35 | Largo 35 | Ancho 35 | Alt 35 | N° 35 | Parcial 40 | Total 34
  const resumenWidths = {
    code: 60,
    desc: 230,
    und: 35,
    largo: 35,
    ancho: 35,
    alto: 35,
    nelem: 35,
    parcial: 40,
    total: 34,
  };

  // Para la hoja resumen: agregamos una fila por hoja con "Total" = sumatoria del período;
  // los campos Largo/Ancho/Alt/N°/Parcial se dejan vacíos (corresponden a planillas).
  const valTable = buildValuationTable({ items, currentLines, previousLines });
  const hierarchy = buildSummaryHierarchy(valTable);

  const ResumenHeader = h(
    View,
    { style: styles.thRow, fixed: true } as any,
    h(Text, { style: [styles.th, { width: resumenWidths.code }] as any }, "ÍTEM"),
    h(Text, { style: [styles.th, { width: resumenWidths.desc }] as any }, "DESCRIPCIÓN"),
    h(Text, { style: [styles.th, { width: resumenWidths.und, textAlign: "center" }] as any }, "UND."),
    h(Text, { style: [styles.th, { width: resumenWidths.largo, textAlign: "center" }] as any }, "LARGO"),
    h(Text, { style: [styles.th, { width: resumenWidths.ancho, textAlign: "center" }] as any }, "ANCHO"),
    h(Text, { style: [styles.th, { width: resumenWidths.alto, textAlign: "center" }] as any }, "ALT."),
    h(Text, { style: [styles.th, { width: resumenWidths.nelem, textAlign: "center" }] as any }, "N° ELEM."),
    h(Text, { style: [styles.th, { width: resumenWidths.parcial, textAlign: "right" }] as any }, "PARCIAL"),
    h(
      Text,
      {
        style: [styles.th, { width: resumenWidths.total, textAlign: "right", borderRightWidth: 0 }] as any,
      },
      "TOTAL",
    ),
  );

  const resumenBody = hierarchy.map((row, idx) => {
    const isLeaf = row.isLeaf;
    const indent = "\u00A0\u00A0".repeat(row.level);
    const desc = `${indent}${row.description || ""}`;
    if (!isLeaf) {
      return h(
        View,
        { key: `res-${idx}`, style: styles.parentRow, wrap: false } as any,
        h(Text, { style: [styles.parentCell, { width: resumenWidths.code }] as any }, row.code),
        h(Text, { style: [styles.parentCell, { width: resumenWidths.desc }] as any }, desc),
        h(Text, { style: [styles.parentCell, { width: resumenWidths.und }] as any }, ""),
        h(Text, { style: [styles.parentCell, { width: resumenWidths.largo }] as any }, ""),
        h(Text, { style: [styles.parentCell, { width: resumenWidths.ancho }] as any }, ""),
        h(Text, { style: [styles.parentCell, { width: resumenWidths.alto }] as any }, ""),
        h(Text, { style: [styles.parentCell, { width: resumenWidths.nelem }] as any }, ""),
        h(Text, { style: [styles.parentCell, { width: resumenWidths.parcial }] as any }, ""),
        h(Text, { style: [styles.parentCell, { width: resumenWidths.total, borderRightWidth: 0 }] as any }, ""),
      );
    }
    return h(
      View,
      { key: `res-${idx}`, style: idx % 2 === 0 ? styles.tr : styles.trAlt, wrap: false } as any,
      h(Text, { style: [styles.td, { width: resumenWidths.code }] as any }, row.code),
      h(Text, { style: [styles.td, { width: resumenWidths.desc }] as any }, desc),
      h(Text, { style: [styles.td, { width: resumenWidths.und, textAlign: "center" }] as any }, row.unit || ""),
      h(Text, { style: [styles.td, { width: resumenWidths.largo, textAlign: "right" }] as any }, ""),
      h(Text, { style: [styles.td, { width: resumenWidths.ancho, textAlign: "right" }] as any }, ""),
      h(Text, { style: [styles.td, { width: resumenWidths.alto, textAlign: "right" }] as any }, ""),
      h(Text, { style: [styles.td, { width: resumenWidths.nelem, textAlign: "right" }] as any }, ""),
      h(Text, { style: [styles.td, { width: resumenWidths.parcial, textAlign: "right" }] as any }, ""),
      h(
        Text,
        {
          style: [
            styles.td,
            { width: resumenWidths.total, textAlign: "right", borderRightWidth: 0, fontFamily: "Helvetica-Bold" },
          ] as any,
        },
        row.total != null ? formatNum(row.total, 2) : "",
      ),
    );
  });

  const ResumenPage = h(
    Page,
    { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "HOJA RESUMEN DE METRADOS"),
    h(View, { style: styles.h1Rule } as any),
    h(
      Text,
      { style: styles.p } as any,
      `Proyecto: ${clean(project.name)}  ·  Valorización N° ${String(period.period_number).padStart(2, "0")}  ·  ${period.date_from} a ${period.date_to}`,
    ),
    hierarchy.length === 0
      ? h(Text, { style: styles.p } as any, "Sin metrados registrados para el período seleccionado.")
      : h(View, { style: styles.table } as any, ResumenHeader, ...resumenBody),
  );

  // ============================================================
  // Sección 2: PLANILLAS DE METRADOS (planilla técnica continua)
  // ============================================================
  // Columnas (suma ≈ 539 pt, A4 portrait con padding 28):
  // PARTIDA 55 | DESCRIPCIÓN 175 | UND 32 | LARGO 48 | ANCHO 44 | ALT 40 | N°ELEM 40 | PARCIAL 50 | TOTAL 55
  const planWidths = {
    partida: 55,
    desc: 175,
    und: 32,
    largo: 48,
    ancho: 44,
    alto: 40,
    nelem: 40,
    parcial: 50,
    total: 55,
  };
  const planDimsWidth = planWidths.largo + planWidths.ancho + planWidths.alto;
  const planTotalWidth =
    planWidths.partida +
    planWidths.desc +
    planWidths.und +
    planDimsWidth +
    planWidths.nelem +
    planWidths.parcial +
    planWidths.total;

  const itemsById = new Map(items.map((it) => [it.id, it]));

  // Agrupar líneas del período por item_id, y ordenar por item_code
  const linesByItem = new Map<string, MetradoLine[]>();
  for (const l of currentLines) {
    const arr = linesByItem.get(l.item_id) ?? [];
    arr.push(l);
    linesByItem.set(l.item_id, arr);
  }

  const executedItems = Array.from(linesByItem.entries())
    .map(([itemId, lines]) => ({ item: itemsById.get(itemId), lines }))
    .filter((x): x is { item: BudgetItemRow; lines: MetradoLine[] } => Boolean(x.item))
    .sort((a, b) => {
      const ca = a.item.item_code ?? "";
      const cb = b.item.item_code ?? "";
      return ca.localeCompare(cb, "es", { numeric: true });
    });

  const PlanillaHeader = h(
    View,
    { style: styles.thRow, fixed: true } as any,
    h(Text, { style: [styles.th, { width: planWidths.n, textAlign: "center" }] as any }, "N°"),
    h(Text, { style: [styles.th, { width: planWidths.desc }] as any }, "DESCRIPCIÓN"),
    h(Text, { style: [styles.th, { width: planWidths.und, textAlign: "center" }] as any }, "UND."),
    h(Text, { style: [styles.th, { width: planWidths.largo, textAlign: "center" }] as any }, "LARGO"),
    h(Text, { style: [styles.th, { width: planWidths.ancho, textAlign: "center" }] as any }, "ANCHO"),
    h(Text, { style: [styles.th, { width: planWidths.alto, textAlign: "center" }] as any }, "ALT."),
    h(Text, { style: [styles.th, { width: planWidths.nelem, textAlign: "center" }] as any }, "N° ELEM."),
    h(
      Text,
      { style: [styles.th, { width: planWidths.parcial, textAlign: "right", borderRightWidth: 0 }] as any },
      "PARCIAL",
    ),
  );

  const planillaSections: any[] = [];

  for (let i = 0; i < executedItems.length; i++) {
    const { item, lines } = executedItems[i];
    const total = lines.reduce((acc, l) => acc + Number(l.partial || 0), 0);

    const headerBox = h(
      View,
      { style: styles.partidaHeader, wrap: false } as any,
      h(
        View,
        { style: { flexDirection: "column" } } as any,
        h(Text, { style: styles.partidaCode } as any, `${item.item_code ?? "—"}  ${item.description ?? ""}`),
        h(
          Text,
          { style: styles.partidaMeta } as any,
          `Und: ${item.unit || "—"}   ·   Metrado base: ${formatNum(Number(item.base_quantity || 0), 4)}`,
        ),
      ),
      h(
        Text,
        { style: styles.partidaCode } as any,
        `Total: ${formatNum(total, 4)} ${item.unit || ""}`,
      ),
    );

    const body = lines.length === 0
      ? [
          h(
            View,
            { key: "empty", style: styles.tr, wrap: false } as any,
            h(
              Text,
              {
                style: [styles.td, { width: 538, textAlign: "center", borderRightWidth: 0 }] as any,
              },
              "Sin líneas registradas.",
            ),
          ),
        ]
      : lines.map((line, idx) =>
          h(
            View,
            { key: line.id, style: idx % 2 === 0 ? styles.tr : styles.trAlt, wrap: false } as any,
            h(Text, { style: [styles.td, { width: planWidths.n, textAlign: "center" }] as any }, String(idx + 1)),
            h(
              Text,
              { style: [styles.td, { width: planWidths.desc }] as any },
              clean(line.description ?? line.observation ?? line.location_ref ?? "—"),
            ),
            h(
              Text,
              { style: [styles.td, { width: planWidths.und, textAlign: "center" }] as any },
              item.unit || "",
            ),
            h(
              Text,
              { style: [styles.td, { width: planWidths.largo, textAlign: "right" }] as any },
              fmt(line.length, 2),
            ),
            h(
              Text,
              { style: [styles.td, { width: planWidths.ancho, textAlign: "right" }] as any },
              fmt(line.width, 2),
            ),
            h(
              Text,
              { style: [styles.td, { width: planWidths.alto, textAlign: "right" }] as any },
              fmt(line.height, 2),
            ),
            h(
              Text,
              { style: [styles.td, { width: planWidths.nelem, textAlign: "right" }] as any },
              line.num_elements != null ? String(line.num_elements) : "",
            ),
            h(
              Text,
              {
                style: [
                  styles.td,
                  { width: planWidths.parcial, textAlign: "right", borderRightWidth: 0, fontFamily: "Helvetica-Bold" },
                ] as any,
              },
              formatNum(Number(line.partial || 0), 4),
            ),
          ),
        );

    const totalRow = h(
      View,
      { style: styles.totalRow, wrap: false } as any,
      h(
        Text,
        {
          style: [
            styles.totalCell,
            {
              width:
                planWidths.n +
                planWidths.desc +
                planWidths.und +
                planWidths.largo +
                planWidths.ancho +
                planWidths.alto +
                planWidths.nelem,
              textAlign: "right",
            },
          ] as any,
        },
        `TOTAL ${item.unit || ""}`,
      ),
      h(
        Text,
        {
          style: [
            styles.totalCell,
            { width: planWidths.parcial, textAlign: "right", borderRightWidth: 0 },
          ] as any,
        },
        formatNum(total, 4),
      ),
    );

    planillaSections.push(
      h(
        View,
        { key: `partida-${item.id}`, wrap: false } as any,
        headerBox,
        h(View, { style: styles.table } as any, PlanillaHeader, ...body, totalRow),
      ),
    );
  }

  const PlanillasPage = h(
    Page,
    { size: "A4", style: styles.page } as any,
    PageHeader(),
    h(Text, { style: styles.h1 } as any, "PLANILLAS DE METRADOS"),
    h(View, { style: styles.h1Rule } as any),
    h(
      Text,
      { style: styles.p } as any,
      "Detalle de líneas de metrado registradas por cada partida ejecutada en el período.",
    ),
    executedItems.length === 0
      ? h(Text, { style: styles.p } as any, "Sin partidas con líneas registradas en el período.")
      : h(Fragment, null, ...planillaSections),
  );

  const doc = h(Document, null, ResumenPage, PlanillasPage);
  const blob = await pdf(doc as any).toBlob();
  const safeCode = clean(project.code).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const fileName = `metrados-ejecutados-${safeCode}-val${String(period.period_number).padStart(2, "0")}.pdf`;
  const url = URL.createObjectURL(blob);
  return { fileName, url, blob };
}
