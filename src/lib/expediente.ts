// Cálculos puros para el Expediente Mensual de Supervisión.
// Importable desde cliente y servidor (sin dependencias de Supabase).

import type { BudgetItemRow } from "@/lib/domain";

export const deductionLabels: Record<string, string> = {
  adelanto_directo: "Amortización adelanto directo",
  adelanto_materiales: "Amortización adelanto de materiales",
  fondo_garantia: "Retención fondo de garantía",
  reintegro: "Deducción por reintegro",
  multa: "Multas",
  penalidad: "Penalidades",
  otra: "Otras deducciones",
};

export type DeductionType = keyof typeof deductionLabels;

export type MetradoLine = {
  id: string;
  item_id: string;
  period_id?: string;
  group_label: string | null;
  location_ref: string | null;
  description: string | null;
  num_elements: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  formula: string | null;
  partial: number;
  observation: string | null;
};

export type DeductionLine = {
  id: string;
  deduction_type: DeductionType;
  description: string | null;
  amount: number;
};

/** Calcula el parcial de una línea de metrado. */
export function computeLinePartial(line: Partial<MetradoLine>): number {
  const n = Number(line.num_elements ?? 1) || 0;
  const l = line.length != null ? Number(line.length) : null;
  const w = line.width != null ? Number(line.width) : null;
  const h = line.height != null ? Number(line.height) : null;

  // Fórmula libre: por simplicidad solo soportamos números puros/multiplicación segura.
  if (line.formula && line.formula.trim()) {
    const expr = line.formula
      .replace(/L/gi, l != null ? String(l) : "1")
      .replace(/A/gi, w != null ? String(w) : "1")
      .replace(/H/gi, h != null ? String(h) : "1")
      .replace(/N/gi, String(n || 1));
    if (/^[\d+\-*/().\s]+$/.test(expr)) {
      try {
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict";return (${expr})`)();
        if (typeof result === "number" && Number.isFinite(result)) return round(result, 4);
      } catch {
        // cae al cálculo geométrico
      }
    }
  }

  // Cálculo geométrico por defecto: usa solo los factores presentes
  let factor = n || 1;
  if (l != null) factor *= l;
  if (w != null) factor *= w;
  if (h != null) factor *= h;
  return round(factor, 4);
}

function round(v: number, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}

export type ValuationItemSummary = {
  item: BudgetItemRow;
  qtyPrev: number;
  qtyCurrent: number;
  qtyAccum: number;
  qtyBalance: number;
  amountPrev: number;
  amountCurrent: number;
  amountAccum: number;
  amountBalance: number;
  pctCurrent: number;
  pctAccum: number;
  pctBalance: number;
};

/** Construye el cuadro de valorización por partida. */
export function buildValuationTable(args: {
  items: BudgetItemRow[];
  currentLines: MetradoLine[];
  previousLines: MetradoLine[]; // de períodos anteriores
}): ValuationItemSummary[] {
  const sumByItem = (lines: MetradoLine[]) => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.item_id, (m.get(l.item_id) ?? 0) + Number(l.partial || 0));
    return m;
  };
  const prevMap = sumByItem(args.previousLines);
  const curMap = sumByItem(args.currentLines);

  return args.items
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((item) => {
      const base = Number(item.base_quantity || 0);
      const price = Number(item.unit_price || 0);
      const qtyPrev = round(prevMap.get(item.id) ?? 0, 4);
      const qtyCurrent = round(curMap.get(item.id) ?? 0, 4);
      const qtyAccum = round(qtyPrev + qtyCurrent, 4);
      const qtyBalance = round(Math.max(base - qtyAccum, 0), 4);
      return {
        item,
        qtyPrev,
        qtyCurrent,
        qtyAccum,
        qtyBalance,
        amountPrev: round(qtyPrev * price, 2),
        amountCurrent: round(qtyCurrent * price, 2),
        amountAccum: round(qtyAccum * price, 2),
        amountBalance: round(qtyBalance * price, 2),
        pctCurrent: base > 0 ? round((qtyCurrent / base) * 100, 2) : 0,
        pctAccum: base > 0 ? round((qtyAccum / base) * 100, 2) : 0,
        pctBalance: base > 0 ? round((qtyBalance / base) * 100, 2) : 0,
      };
    });
}

export function totals(rows: ValuationItemSummary[]) {
  return rows.reduce(
    (acc, r) => ({
      base: acc.base + Number(r.item.partial_amount || r.item.base_quantity * r.item.unit_price || 0),
      prev: acc.prev + r.amountPrev,
      current: acc.current + r.amountCurrent,
      accum: acc.accum + r.amountAccum,
      balance: acc.balance + r.amountBalance,
    }),
    { base: 0, prev: 0, current: 0, accum: 0, balance: 0 },
  );
}

export function formatNum(n: number, d = 2) {
  return new Intl.NumberFormat("es-PE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}

export function formatMoney(n: number, currency = "PEN") {
  return new Intl.NumberFormat("es-PE", { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
}
