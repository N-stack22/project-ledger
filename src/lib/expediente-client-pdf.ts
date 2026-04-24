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

type TotalsLike = {
  base: number;
  prev: number;
  current: number;
  accum: number;
  balance: number;
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
};

type PdfDocument = InstanceType<(typeof import("jspdf"))["jsPDF"]>;

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 278;

function clean(value: unknown) {
  return String(value ?? "-").replace(/\s+/g, " ").trim() || "-";
}

function formatLocation(project: ProjectRow) {
  return [project.location, project.district, project.province, project.department].filter(Boolean).join(", ") || "-";
}

function addHeader(pdf: PdfDocument, project: ProjectRow, period: PeriodLike) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(95, 95, 95);
  pdf.text(
    `${clean(project.name)} | Valorización N° ${String(period.period_number).padStart(2, "0")} | ${period.date_from} a ${period.date_to}`,
    MARGIN,
    10,
    { maxWidth: CONTENT_WIDTH },
  );
  pdf.setDrawColor(150);
  pdf.line(MARGIN, 12, PAGE_WIDTH - MARGIN, 12);
  pdf.setTextColor(20, 20, 20);
}

function addPageNumber(pdf: PdfDocument) {
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    pdf.text(`Pág. ${page} / ${pages}`, PAGE_WIDTH - MARGIN, 287, { align: "right" });
  }
  pdf.setTextColor(20, 20, 20);
}

function ensureSpace(pdf: PdfDocument, y: number, needed = 12, project?: ProjectRow, period?: PeriodLike) {
  if (y + needed <= BOTTOM) return y;
  pdf.addPage();
  if (project && period) addHeader(pdf, project, period);
  return 20;
}

function title(pdf: PdfDocument, text: string, y: number, project?: ProjectRow, period?: PeriodLike) {
  y = ensureSpace(pdf, y, 16, project, period);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(text, MARGIN, y);
  pdf.setDrawColor(30);
  pdf.line(MARGIN, y + 2, PAGE_WIDTH - MARGIN, y + 2);
  return y + 9;
}

function subtitle(pdf: PdfDocument, text: string, y: number, project?: ProjectRow, period?: PeriodLike) {
  y = ensureSpace(pdf, y, 9, project, period);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(text, MARGIN, y);
  return y + 6;
}

function paragraph(pdf: PdfDocument, text: string, y: number, project: ProjectRow, period: PeriodLike, size = 9) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(size);
  const lines = pdf.splitTextToSize(clean(text), CONTENT_WIDTH);
  for (const line of lines) {
    y = ensureSpace(pdf, y, 5, project, period);
    pdf.text(line, MARGIN, y);
    y += 4.8;
  }
  return y + 2;
}

function fichaRow(pdf: PdfDocument, label: string, value: string, y: number, project: ProjectRow, period: PeriodLike) {
  y = ensureSpace(pdf, y, 8, project, period);
  pdf.setFontSize(8.5);
  pdf.setDrawColor(215);
  pdf.line(MARGIN, y + 2, PAGE_WIDTH - MARGIN, y + 2);
  pdf.setFont("helvetica", "bold");
  pdf.text(label, MARGIN, y);
  pdf.setFont("helvetica", "normal");
  const wrapped = pdf.splitTextToSize(clean(value), 105);
  pdf.text(wrapped, 80, y);
  return y + Math.max(6, wrapped.length * 4.2);
}

function tableHeader(pdf: PdfDocument, headers: Array<{ text: string; width: number }>, y: number) {
  pdf.setFillColor(235, 235, 235);
  pdf.setDrawColor(170);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.2);
  let x = MARGIN;
  for (const header of headers) {
    pdf.rect(x, y - 4, header.width, 7, "FD");
    pdf.text(header.text, x + 1.5, y);
    x += header.width;
  }
  return y + 4;
}

function tableRow(pdf: PdfDocument, cells: Array<{ text: string; width: number; align?: "left" | "right" | "center" }>, y: number) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setDrawColor(215);
  const wrapped = cells.map((cell) => pdf.splitTextToSize(clean(cell.text), cell.width - 2));
  const height = Math.max(6, ...wrapped.map((lines) => lines.length * 3.4 + 2));
  let x = MARGIN;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    pdf.rect(x, y - 4, cell.width, height);
    const textX = cell.align === "right" ? x + cell.width - 1.5 : cell.align === "center" ? x + cell.width / 2 : x + 1.5;
    pdf.text(wrapped[index], textX, y, { align: cell.align ?? "left", maxWidth: cell.width - 2 });
    x += cell.width;
  }
  return y + height;
}

function renderTable(
  pdf: PdfDocument,
  headers: Array<{ text: string; width: number }>,
  rows: Array<Array<{ text: string; width: number; align?: "left" | "right" | "center" }>>,
  y: number,
  project: ProjectRow,
  period: PeriodLike,
) {
  y = ensureSpace(pdf, y, 14, project, period);
  y = tableHeader(pdf, headers, y);
  for (const row of rows) {
    y = ensureSpace(pdf, y, 10, project, period);
    if (y === 20) y = tableHeader(pdf, headers, y);
    y = tableRow(pdf, row, y);
  }
  return y + 3;
}

function validateExpedienteData(args: GenerateArgs) {
  const missing: string[] = [];
  const requiredFields: Array<[keyof ProjectRow, string]> = [
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

  for (const [key, label] of requiredFields) {
    const value = args.project[key];
    if (value == null || value === "" || value === 0) missing.push(`Ficha técnica → ${label}`);
  }

  if (!args.project.contract_amount || Number(args.project.contract_amount) <= 0) missing.push("Ficha técnica → Monto contractual");
  if (args.items.length === 0) missing.push("Presupuesto → No hay partidas registradas para este proyecto");
  if (args.currentLines.length === 0) missing.push("Metrados → No hay metrados detallados registrados para este período");
  if (args.totals.current <= 0) missing.push("Valorización → Los metrados del período no generan una valorización mayor a 0");

  if (missing.length > 0) {
    throw new Error("Falta información para generar el expediente:\n• " + missing.join("\n• "));
  }
}

export async function generateExpedienteClientPdf(args: GenerateArgs) {
  validateExpedienteData(args);

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const { project, period, currency } = args;

  pdf.setProperties({
    title: `Expediente mensual - ${project.name}`,
    subject: `Valorización N° ${period.period_number}`,
    creator: "Lovable",
  });

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("EXPEDIENTE MENSUAL", PAGE_WIDTH / 2, 95, { align: "center" });
  pdf.setFontSize(14);
  pdf.text("SUPERVISIÓN / VALORIZACIÓN", PAGE_WIDTH / 2, 105, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(clean(project.name), PAGE_WIDTH / 2, 122, { align: "center", maxWidth: 170 });
  pdf.text(`Valorización N° ${String(period.period_number).padStart(2, "0")}`, PAGE_WIDTH / 2, 136, { align: "center" });
  pdf.text(`Periodo: ${period.date_from} a ${period.date_to}`, PAGE_WIDTH / 2, 144, { align: "center" });
  pdf.text(`Entidad: ${clean(project.entity_name)}`, PAGE_WIDTH / 2, 158, { align: "center", maxWidth: 170 });
  pdf.text(`Contratista: ${clean(project.contractor_name)}`, PAGE_WIDTH / 2, 166, { align: "center", maxWidth: 170 });

  pdf.addPage();
  addHeader(pdf, project, period);
  let y = title(pdf, "ÍNDICE", 25, project, period);
  [
    "1. Carta de presentación",
    "2. Ficha técnica de obra",
    "3. Memoria valorizada e informe técnico",
    "4. Metrados ejecutados - Hoja resumen",
    "5. Planillas de metrados por partida",
    "6. Cuadro de valorización de obra",
    "7. Resumen de valorización y deducciones",
  ].forEach((text) => {
    y = paragraph(pdf, text, y, project, period, 10);
  });

  pdf.addPage();
  addHeader(pdf, project, period);
  y = title(pdf, "FICHA TÉCNICA DE OBRA", 25, project, period);
  y = fichaRow(pdf, "Nombre de la obra", project.name, y, project, period);
  y = fichaRow(pdf, "Código", project.code, y, project, period);
  y = fichaRow(pdf, "Entidad", project.entity_name || "-", y, project, period);
  y = fichaRow(pdf, "Unidad ejecutora", project.executing_unit || "-", y, project, period);
  y = fichaRow(pdf, "Contratista", project.contractor_name || "-", y, project, period);
  y = fichaRow(pdf, "Modalidad de ejecución", project.execution_modality || "-", y, project, period);
  y = fichaRow(pdf, "Contrato de ejecución", project.execution_contract || "-", y, project, period);
  y = fichaRow(pdf, "Contrato de supervisión", project.supervision_contract || "-", y, project, period);
  y = fichaRow(pdf, "Residente de obra", project.resident_name || "-", y, project, period);
  y = fichaRow(pdf, "Supervisor", project.supervisor_name || "-", y, project, period);
  y = fichaRow(pdf, "Ubicación", formatLocation(project), y, project, period);
  y = fichaRow(pdf, "Fecha de inicio", project.start_date || "-", y, project, period);
  y = fichaRow(pdf, "Plazo de ejecución", `${project.execution_term_days || "-"} días`, y, project, period);
  y = fichaRow(pdf, "Fecha de término", project.planned_completion_date || project.planned_end_date || "-", y, project, period);
  y = fichaRow(pdf, "Estado", project.status, y, project, period);
  y = subtitle(pdf, "Presupuesto de obra", y + 3, project, period);
  y = fichaRow(pdf, "Costo directo", formatMoney(Number(project.direct_cost || 0), currency), y, project, period);
  y = fichaRow(pdf, "Gastos generales", formatMoney(Number(project.overhead_cost || 0), currency), y, project, period);
  y = fichaRow(pdf, "Utilidad", formatMoney(Number(project.utility_amount || 0), currency), y, project, period);
  y = fichaRow(pdf, "IGV", formatMoney(Number(project.igv_amount || 0), currency), y, project, period);
  y = fichaRow(pdf, "Monto contractual", formatMoney(Number(project.contract_amount || 0), currency), y, project, period);

  pdf.addPage();
  addHeader(pdf, project, period);
  y = title(pdf, "MEMORIA VALORIZADA E INFORME TÉCNICO", 25, project, period);
  y = subtitle(pdf, "1. Generalidades", y, project, period);
  y = paragraph(pdf, period.generalidades || "-", y, project, period);
  y = subtitle(pdf, "2. Ubicación", y, project, period);
  y = paragraph(pdf, formatLocation(project), y, project, period);
  y = subtitle(pdf, "3. Metas del proyecto", y, project, period);
  y = paragraph(pdf, period.metas || "-", y, project, period);
  y = subtitle(pdf, "4. Resumen de avances", y, project, period);
  y = paragraph(pdf, `Avance acumulado anterior: ${formatMoney(args.totals.prev, currency)}`, y, project, period);
  y = paragraph(pdf, `Valorización del período: ${formatMoney(args.totals.current, currency)}`, y, project, period);
  y = paragraph(pdf, `Acumulado a la fecha: ${formatMoney(args.totals.accum, currency)}`, y, project, period);
  y = paragraph(pdf, `Saldo por valorizar: ${formatMoney(args.totals.balance, currency)}`, y, project, period);
  y = subtitle(pdf, "5. Ocurrencias", y, project, period);
  y = paragraph(pdf, period.ocurrencias || "-", y, project, period);
  y = subtitle(pdf, "6. Conclusiones", y, project, period);
  y = paragraph(pdf, period.conclusiones || "-", y, project, period);

  pdf.addPage();
  addHeader(pdf, project, period);
  y = title(pdf, "HOJA RESUMEN DE METRADOS", 25, project, period);
  const resumenRows = args.valTable
    .filter((row) => row.qtyCurrent > 0)
    .map((row) => [
      { text: row.item.item_code || "-", width: 22 },
      { text: row.item.description, width: 105 },
      { text: row.item.unit, width: 18, align: "center" as const },
      { text: formatNum(row.qtyCurrent, 2), width: 37, align: "right" as const },
    ]);
  y = renderTable(
    pdf,
    [
      { text: "Ítem", width: 22 },
      { text: "Descripción", width: 105 },
      { text: "Und.", width: 18 },
      { text: "Metrado actual", width: 37 },
    ],
    resumenRows,
    y,
    project,
    period,
  );

  y = title(pdf, "PLANILLAS DE METRADOS POR PARTIDA", y + 3, project, period);
  const itemById = new Map(args.items.map((item) => [item.id, item]));
  const linesByItem = new Map<string, MetradoLine[]>();
  for (const line of args.currentLines) {
    const list = linesByItem.get(line.item_id) ?? [];
    list.push(line);
    linesByItem.set(line.item_id, list);
  }
  for (const [itemId, lines] of linesByItem.entries()) {
    const item = itemById.get(itemId);
    if (!item) continue;
    y = subtitle(pdf, `${item.item_code || ""} ${item.description} (${item.unit})`, y, project, period);
    y = renderTable(
      pdf,
      [
        { text: "Ubicación", width: 35 },
        { text: "Descripción", width: 56 },
        { text: "N°", width: 15 },
        { text: "L", width: 18 },
        { text: "A", width: 18 },
        { text: "H", width: 18 },
        { text: "Parcial", width: 22 },
      ],
      lines.map((line) => [
        { text: [line.group_label, line.location_ref].filter(Boolean).join(" / ") || "-", width: 35 },
        { text: line.description || "-", width: 56 },
        { text: formatNum(Number(line.num_elements ?? 1), 2), width: 15, align: "right" as const },
        { text: line.length != null ? formatNum(Number(line.length), 2) : "-", width: 18, align: "right" as const },
        { text: line.width != null ? formatNum(Number(line.width), 2) : "-", width: 18, align: "right" as const },
        { text: line.height != null ? formatNum(Number(line.height), 2) : "-", width: 18, align: "right" as const },
        { text: formatNum(Number(line.partial), 2), width: 22, align: "right" as const },
      ]),
      y,
      project,
      period,
    );
  }

  pdf.addPage("a4", "landscape");
  const landscapeWidth = 297;
  pdf.setFontSize(8);
  pdf.text(`${clean(project.name)} | Valorización N° ${period.period_number}`, 14, 10);
  pdf.line(14, 12, landscapeWidth - 14, 12);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("CUADRO DE VALORIZACIÓN DE OBRA", 14, 25);
  pdf.setFont("helvetica", "normal");
  const landscapeRows = args.valTable.map((row) => [
    { text: row.item.item_code || "-", width: 18 },
    { text: row.item.description, width: 72 },
    { text: row.item.unit, width: 12, align: "center" as const },
    { text: formatNum(Number(row.item.base_quantity), 2), width: 20, align: "right" as const },
    { text: formatNum(row.qtyPrev, 2), width: 18, align: "right" as const },
    { text: formatNum(row.qtyCurrent, 2), width: 20, align: "right" as const },
    { text: formatNum(row.qtyAccum, 2), width: 20, align: "right" as const },
    { text: formatMoney(row.amountCurrent, currency), width: 32, align: "right" as const },
    { text: `${formatNum(row.pctAccum, 1)}%`, width: 20, align: "right" as const },
    { text: formatNum(row.qtyBalance, 2), width: 20, align: "right" as const },
  ]);
  renderTable(
    pdf,
    [
      { text: "Ítem", width: 18 },
      { text: "Descripción", width: 72 },
      { text: "Und", width: 12 },
      { text: "Meta", width: 20 },
      { text: "Ant.", width: 18 },
      { text: "Actual", width: 20 },
      { text: "Acum.", width: 20 },
      { text: "Monto actual", width: 32 },
      { text: "%", width: 20 },
      { text: "Saldo", width: 20 },
    ],
    landscapeRows,
    36,
    project,
    period,
  );

  pdf.addPage();
  addHeader(pdf, project, period);
  y = title(pdf, "RESUMEN DE VALORIZACIÓN Y DEDUCCIONES", 25, project, period);
  y = fichaRow(pdf, "Monto contractual", formatMoney(Number(project.contract_amount || 0), currency), y, project, period);
  y = fichaRow(pdf, "Acumulado anterior", formatMoney(args.totals.prev, currency), y, project, period);
  y = fichaRow(pdf, "Valorización del período", formatMoney(args.totals.current, currency), y, project, period);
  y = fichaRow(pdf, "Acumulado a la fecha", formatMoney(args.totals.accum, currency), y, project, period);
  y = fichaRow(pdf, "Saldo por valorizar", formatMoney(args.totals.balance, currency), y, project, period);
  y = subtitle(pdf, "Deducciones", y + 3, project, period);
  y = renderTable(
    pdf,
    [
      { text: "Concepto", width: 135 },
      { text: "Monto", width: 47 },
    ],
    args.deductions.length === 0
      ? [[{ text: "Sin deducciones registradas", width: 135 }, { text: formatMoney(0, currency), width: 47, align: "right" as const }]]
      : args.deductions.map((deduction) => [
          { text: `${deductionLabels[deduction.deduction_type]}${deduction.description ? ` - ${deduction.description}` : ""}`, width: 135 },
          { text: formatMoney(Number(deduction.amount), currency), width: 47, align: "right" as const },
        ]),
    y,
    project,
    period,
  );
  y = fichaRow(pdf, "TOTAL DEDUCCIONES", formatMoney(args.totalDeductions, currency), y, project, period);
  y = fichaRow(pdf, "MONTO NETO A PAGAR", formatMoney(args.netAmount, currency), y, project, period);
  y = ensureSpace(pdf, y + 24, 35, project, period);
  pdf.line(35, y, 85, y);
  pdf.line(125, y, 175, y);
  pdf.setFontSize(9);
  pdf.text(project.resident_name || "Residente de Obra", 60, y + 5, { align: "center" });
  pdf.text(project.supervisor_name || "Supervisor", 150, y + 5, { align: "center" });

  addPageNumber(pdf);

  const safeCode = clean(project.code).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const fileName = `expediente-${safeCode}-val${String(period.period_number).padStart(2, "0")}.pdf`;
  const blob = pdf.output("blob");
  const url = URL.createObjectURL(blob);

  return { fileName, url, blob };
}
