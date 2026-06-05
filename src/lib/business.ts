import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import type {
  AppRole,
  AuditSummary,
  BudgetColumnKey,
  BudgetDetectionResult,
  BudgetItemRow,
  BudgetPreviewRow,
  ContractType,
  DashboardMetric,
  DocumentStatus,
  LiquidationRow,
  MemoriaRow,
  MetradoEntryRow,
  ProjectRow,
  ValuationLineRow,
  ValuationRow,
} from "@/lib/domain";
import { parseRichTextDocument, stripHtml } from "@/lib/domain";


export const roleLabels: Record<AppRole, string> = {
  admin: "Admin",
  assistant: "Asistente de obra",
  resident: "Residente de obra",
  supervisor: "Supervisor",
  legal_representative: "Representante legal",
};

export const contractTypeLabels: Record<ContractType, string> = {
  precios_unitarios: "Precios unitarios",
  suma_alzada: "Suma alzada",
};

export const documentStatusLabels: Record<DocumentStatus, string> = {
  draft: "Borrador",
  in_review: "En revisión",
  approved: "Aprobada",
  rejected: "Observada",
};

export const valuationStatusLabels = {
  pending: "Pendiente",
  reviewed: "Revisada",
  approved: "Aprobada",
  rejected: "Rechazada",
} as const;

export const projectStatusLabels = {
  draft: "Borrador",
  active: "En ejecución",
  closing: "En cierre",
  closed: "Cerrada",
  archived: "Archivada",
  cancelled: "Cancelada",
} as const;

export function formatCurrency(value: number, currency = "PEN") {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("es-PE", { maximumFractionDigits }).format(value || 0);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function toPeriodDate(value: string) {
  const date = new Date(value);
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export function getPeriodLabel(value: string) {
  return new Intl.DateTimeFormat("es-PE", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function calculateProjectProgress(project: ProjectRow, valuations: ValuationRow[]) {
  const approved = valuations.filter((valuation) => valuation.project_id === project.id && valuation.status === "approved");
  if (!approved.length) return Number(project.progress_percent || 0);

  if (project.contract_type === "suma_alzada") {
    return Math.max(...approved.map((valuation) => Number(valuation.progress_percent || 0)));
  }

  const totalNet = approved.reduce((sum, valuation) => sum + Number(valuation.net_amount || 0), 0);
  if (!project.contract_amount) return 0;
  return Math.min(100, (totalNet / Number(project.contract_amount)) * 100);
}

export function calculateValuationFromData(args: {
  project: ProjectRow;
  metrados: MetradoEntryRow[];
  items: ValuationLineRow[] | Array<{ item_id: string; quantity: number; unit_price: number }>;
  progressPercent?: number;
}) {
  const { project, metrados, items, progressPercent = 0 } = args;
  const totalQuantity = metrados.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  if (project.contract_type === "suma_alzada") {
    const grossAmount = (Number(project.contract_amount) * progressPercent) / 100;
    return {
      totalQuantity,
      grossAmount,
      progressPercent,
      lineAmount: grossAmount,
    };
  }

  const grossAmount = items.reduce((sum, item) => {
    const quantity = "quantity" in item ? Number(item.quantity || 0) : Number(item.quantity_period || 0);
    const unitPrice = "unit_price" in item ? Number(item.unit_price || 0) : Number(item.unit_price_applied || 0);
    return sum + quantity * unitPrice;
  }, 0);

  const derivedProgress = project.contract_amount
    ? Math.min(100, (grossAmount / Number(project.contract_amount)) * 100)
    : progressPercent;

  return {
    totalQuantity,
    grossAmount,
    progressPercent: derivedProgress,
    lineAmount: grossAmount,
  };
}

export function buildDashboardMetrics(projects: ProjectRow[], valuations: ValuationRow[], memorias: MemoriaRow[]): DashboardMetric[] {
  const approvedValuations = valuations.filter((valuation) => valuation.status === "approved");
  const approvedMemorias = memorias.filter((memoria) => memoria.status === "approved");
  const totalNet = approvedValuations.reduce((sum, valuation) => sum + Number(valuation.net_amount || 0), 0);

  return [
    {
      label: "Proyectos activos",
      value: String(projects.filter((project) => project.status === "active").length),
      hint: `${projects.length} proyectos registrados`,
    },
    {
      label: "Valorizado aprobado",
      value: formatCurrency(totalNet),
      hint: `${approvedValuations.length} valorizaciones aprobadas`,
    },
    {
      label: "Memorias aprobadas",
      value: String(approvedMemorias.length),
      hint: `${memorias.length} memorias en total`,
    },
    {
      label: "Pendientes de revisión",
      value: String(valuations.filter((valuation) => valuation.status === "pending").length),
      hint: "Cola actual del supervisor",
    },
  ];
}

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBudgetCell(value: unknown) {
  return normalizeHeader(String(value ?? ""));
}

function parseBudgetNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const sanitized = raw.replace(/[^\d,.-]/g, "").replace(/(?!^)-/g, "");
  if (!sanitized) return 0;

  const lastComma = sanitized.lastIndexOf(",");
  const lastDot = sanitized.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const normalized = sanitized
      .replace(decimalSeparator === "," ? /\./g : /,/g, "")
      .replace(decimalSeparator, ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (lastComma > -1) {
    const normalized = /^-?\d+(,\d{1,2})$/.test(sanitized)
      ? sanitized.replace(",", ".")
      : sanitized.replace(/,/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (lastDot > -1) {
    const normalized = /^-?\d+(\.\d{1,2})$/.test(sanitized)
      ? sanitized
      : sanitized.replace(/\./g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getBudgetHierarchyMeta(itemCode: string) {
  const code = itemCode.trim();
  if (!code) return { hierarchy_level: null, parent_item_code: null };

  const parts = code.split(".").filter(Boolean);
  return {
    hierarchy_level: parts.length || null,
    parent_item_code: parts.length > 1 ? parts.slice(0, -1).join(".") : null,
  };
}

function matchesBudgetAlias(cell: string, alias: string) {
  if (!cell || !alias) return false;

  const compactCell = cell.replace(/\s+/g, "");
  const compactAlias = alias.replace(/\s+/g, "");

  return cell === alias || compactCell === compactAlias || cell.includes(alias) || compactCell.includes(compactAlias);
}

type BudgetHeaderMatch = {
  rowIndex: number;
  headerDepth: 1 | 2;
  score: number;
  mapping: Partial<Record<BudgetColumnKey, { index: number; label: string }>>;
};

function detectBudgetHeader(rows: unknown[][], synonyms: Record<string, string[]>): BudgetHeaderMatch | null {
  const requiredFields: BudgetColumnKey[] = ["description", "unit", "base_quantity", "unit_price"];
  let bestMatch: BudgetHeaderMatch | null = null;

  const maxRowsToInspect = Math.min(rows.length, 40);

  for (let rowIndex = 0; rowIndex < maxRowsToInspect; rowIndex += 1) {
    const currentRow = rows[rowIndex] ?? [];
    const nextRow = rows[rowIndex + 1] ?? [];
    const candidates: Array<{ headerDepth: 1 | 2; cells: string[] }> = [
      { headerDepth: 1, cells: currentRow.map((cell) => String(cell ?? "").trim()) },
      {
        headerDepth: 2,
        cells: Array.from({ length: Math.max(currentRow.length, nextRow.length) }, (_, columnIndex) =>
          [currentRow[columnIndex], nextRow[columnIndex]].filter(Boolean).join(" ").trim(),
        ),
      },
    ];

    candidates.forEach(({ headerDepth, cells }) => {
      const mapping = Object.entries(synonyms).reduce<Partial<Record<BudgetColumnKey, { index: number; label: string }>>>((accumulator, [field, aliases]) => {
        const matchIndex = cells.findIndex((cell) => {
          const normalizedCell = normalizeBudgetCell(cell);
          return aliases.some((alias) => matchesBudgetAlias(normalizedCell, normalizeHeader(alias)));
        });

        if (matchIndex >= 0) {
          accumulator[field as BudgetColumnKey] = { index: matchIndex, label: cells[matchIndex] };
        }

        return accumulator;
      }, {});

      const score = Object.keys(mapping).length;
      const requiredMatches = requiredFields.filter((field) => mapping[field]).length;

      if (requiredMatches < 3 || score === 0) return;

      if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && headerDepth < bestMatch.headerDepth)) {
        bestMatch = { rowIndex, headerDepth, score, mapping };
      }
    });
  }

  return bestMatch;
}

export function detectBudgetWorkbook(file: File): Promise<BudgetDetectionResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
          header: 1,
          defval: null,
          blankrows: false,
        });

        const mapping: BudgetDetectionResult["mapping"] = {};
        const warnings: string[] = [];

        const synonyms: Record<string, string[]> = {
          item_code: ["item", "item codigo", "item / item / codigo", "codigo", "codigo partida", "cod partida", "item partida", "partida"],
          description: ["descripcion", "descripcion partida", "detalle", "concepto"],
          unit: ["und", "und.", "unidad", "u m", "u.m.", "um"],
          base_quantity: ["metrado", "cantidad", "cantidad base", "metrados"],
          unit_price: ["precio s", "precio unitario", "p unitario", "p.u.", "pu", "precio"],
          partial_amount: ["parcial s", "parcial", "subtotal", "importe", "monto", "total"],
          category: ["categoria", "capitulo", "especialidad"],
        };

        const detectedHeader = detectBudgetHeader(sheetRows, synonyms);

        if (!detectedHeader) {
          resolve({
            mapping,
            rows: [],
            warnings: ["No se encontró una tabla válida del presupuesto. Verifica que el archivo tenga encabezados reconocibles como descripción, unidad, metrado y precio unitario."],
          });
          return;
        }

        const headerMatch = detectedHeader;

        Object.entries(headerMatch.mapping).forEach(([field, value]) => {
          if (value) {
            mapping[field as BudgetColumnKey] = value.label;
          }
        });

        if (!mapping.description) warnings.push("No se detectó automáticamente la columna de descripción.");
        if (!mapping.unit) warnings.push("No se detectó automáticamente la columna de unidad.");
        if (!mapping.base_quantity) warnings.push("No se detectó automáticamente la columna de metrado base.");
        if (!mapping.unit_price) warnings.push("No se detectó automáticamente la columna de precio unitario.");

        const dataRows = sheetRows.slice(headerMatch.rowIndex + headerMatch.headerDepth);

        const parsedRows = dataRows.flatMap<BudgetPreviewRow>((row) => {
          const getValue = (field: BudgetColumnKey) => {
            const column = headerMatch.mapping[field];
            return column ? row[column.index] : null;
          };

          const description = String(getValue("description") ?? "").trim();
          const unit = String(getValue("unit") ?? "").trim();
          const baseQuantity = parseBudgetNumber(getValue("base_quantity"));
          const unitPrice = parseBudgetNumber(getValue("unit_price"));
          const partialAmount = parseBudgetNumber(getValue("partial_amount")) || baseQuantity * unitPrice;
          const itemCode = String(getValue("item_code") ?? "").trim();
          const category = String(getValue("category") ?? "").trim();

          if (!description) return [];
          if (!/[a-z0-9]/i.test(description)) return [];
          // Aceptar filas padre/agrupadoras: tienen item_code + descripción pero sin unidad/precio.
          // Se importan con unit="" y cantidades en 0 para preservar la jerarquía del Excel.
          const isParentRow = !unit && baseQuantity === 0 && unitPrice === 0;
          if (!isParentRow && !unit) return [];

          return [{
            item_code: itemCode || undefined,
            description,
            unit,
            base_quantity: baseQuantity,
            unit_price: unitPrice,
            partial_amount: partialAmount,
            ...getBudgetHierarchyMeta(itemCode),
            category: category || undefined,
          }];
        });

        if (!parsedRows.length) {
          warnings.push("Se detectaron encabezados, pero no se encontraron filas válidas de partidas debajo de la tabla.");
        }

        resolve({ mapping, rows: parsedRows, warnings });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function downloadWorkbook(name: string, sheets: Record<string, Record<string, unknown>[]>) {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([sheetName, rows]) => {
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  });
  XLSX.writeFile(workbook, `${name}.xlsx`);
}

export function exportMetradosWorkbook(project: ProjectRow, metrados: MetradoEntryRow[], items: { [key: string]: string }) {
  downloadWorkbook(`metrados-${project.code}`,
    {
      Metrados: metrados.map((entry) => ({
        Fecha: formatDate(entry.entry_date),
        Periodo: getPeriodLabel(entry.period_month),
        Partida: items[entry.item_id] || entry.item_id,
        Cantidad: Number(entry.quantity),
        Estado: entry.status,
        Observaciones: entry.notes || "",
      })),
    },
  );
}

export function exportFinancialWorkbook(projects: ProjectRow[], valuations: ValuationRow[]) {
  downloadWorkbook("reporte-financiero-jjpp", {
    Proyectos: projects.map((project) => ({
      Codigo: project.code,
      Proyecto: project.name,
      Cliente: project.client_name || "",
      Contrato: contractTypeLabels[project.contract_type],
      Monto: Number(project.contract_amount),
      Estado: projectStatusLabels[project.status],
    })),
    Valorizaciones: valuations.map((valuation) => ({
      Proyecto: valuation.project_id,
      Periodo: getPeriodLabel(valuation.period_month),
      Bruto: Number(valuation.gross_amount),
      Deducciones: Number(valuation.deductions_amount),
      Neto: Number(valuation.net_amount),
      Estado: valuationStatusLabels[valuation.status],
    })),
  });
}

export function exportMemoriaPdf(project: ProjectRow, memoria: MemoriaRow) {
  const doc = new jsPDF();
  const content = parseRichTextDocument(memoria.content_json);
  doc.setFontSize(18);
  doc.text("Memoria valorizada", 14, 18);
  doc.setFontSize(11);
  doc.text(`Proyecto: ${project.name}`, 14, 28);
  doc.text(`Periodo: ${getPeriodLabel(memoria.period_month)}`, 14, 35);
  doc.text(`Estado: ${documentStatusLabels[memoria.status]}`, 14, 42);

  const lines = doc.splitTextToSize(stripHtml(content.html || content.plainText || memoria.executive_summary || "Sin contenido"), 180);
  doc.text(lines, 14, 54);
  doc.save(`memoria-${project.code}-${memoria.period_month}.pdf`);
}

export function exportValuationPdf(project: ProjectRow, valuation: ValuationRow, lines: ValuationLineRow[]) {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text("Reporte de valorización", 14, 18);
  doc.setFontSize(11);
  doc.text(`Proyecto: ${project.name}`, 14, 28);
  doc.text(`Periodo: ${getPeriodLabel(valuation.period_month)}`, 14, 35);
  doc.text(`Contrato: ${contractTypeLabels[valuation.contract_type_snapshot]}`, 14, 42);
  doc.text(`Neto: ${formatCurrency(Number(valuation.net_amount), project.currency_code)}`, 14, 49);

  autoTable(doc, {
    startY: 58,
    head: [["Partida", "Cantidad período", "Acumulado", "Precio", "Subtotal"]],
    body: lines.map((line) => [
      line.item_id,
      formatNumber(Number(line.quantity_period), 4),
      formatNumber(Number(line.quantity_accumulated), 4),
      formatCurrency(Number(line.unit_price_applied), project.currency_code),
      formatCurrency(Number(line.line_amount), project.currency_code),
    ]),
    styles: {
      fontSize: 9,
    },
    headStyles: {
      fillColor: [22, 78, 163],
    },
  });

  doc.save(`valorizacion-${project.code}-${valuation.period_month}.pdf`);
}

export function exportLiquidationPdf(project: ProjectRow, liquidation: LiquidationRow, valuations: ValuationRow[]) {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text("Liquidación de obra", 14, 18);
  doc.setFontSize(11);
  doc.text(`Proyecto: ${project.name}`, 14, 28);
  doc.text(`Total valorizado: ${formatCurrency(Number(liquidation.total_valued_amount), project.currency_code)}`, 14, 36);
  doc.text(`Deducciones: ${formatCurrency(Number(liquidation.total_deductions_amount), project.currency_code)}`, 14, 44);
  doc.text(`Monto final: ${formatCurrency(Number(liquidation.final_amount), project.currency_code)}`, 14, 52);

  autoTable(doc, {
    startY: 62,
    head: [["Periodo", "Estado", "Neto"]],
    body: valuations.map((valuation) => [
      getPeriodLabel(valuation.period_month),
      valuationStatusLabels[valuation.status],
      formatCurrency(Number(valuation.net_amount), project.currency_code),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [22, 78, 163] },
  });

  doc.save(`liquidacion-${project.code}.pdf`);
}

export function buildAuditSummary(rows: Array<{ action: string; created_at: string; entity_type: string; actor_user_id: string | null }>): AuditSummary[] {
  return rows.slice(0, 8).map((row) => ({
    action: row.action,
    actor: row.actor_user_id ? row.actor_user_id.slice(0, 8) : "Sistema",
    timestamp: formatDateTime(row.created_at),
    entity: row.entity_type,
  }));
}
