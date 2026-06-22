/**
 * Cálculo de la Hoja de Valorización mensual según formato peruano
 * (OSCE / Reconstrucción con Cambios). Letras A–Q de la cartilla estándar.
 *
 * Función pura — todas las dependencias se inyectan; sin acceso a DB ni IO.
 * Toda cantidad monetaria está en la moneda del proyecto (no se convierte).
 */

export interface ValuationBreakdownInput {
  /** Suma de partidas valorizadas del mes a precio unitario del expediente
   *  (a "valor referencial", antes de aplicar factor de relación). */
  monthlyDirectCostAtReference: number;

  /** Porcentajes contractuales del proyecto (decimales: 0.08 = 8%). */
  overheadPercentage: number;     // GG sobre costo directo
  profitPercentage: number;       // Utilidad sobre costo directo

  /** Factor de relación = monto_contratado / valor_referencial.
   *  Si no hay valor referencial registrado, usar 1. */
  relationFactor: number;

  /** K calculado por la fórmula polinómica para el mes (1 = sin reajuste). */
  reajusteK: number;

  /** Reintegro de reajuste reconocido por meses anteriores (H). */
  prevMonthReajusteReintegro?: number;

  /** Deducción de reajuste que no corresponde (I). */
  reajusteDrnc?: number;

  /** Deducciones del mes — todos los rubros tipificados. */
  amortDirectAdvance?: number;
  amortMaterialsAdvance?: number;
  dedDrncDirect?: number;
  dedDrncMaterials?: number;
  otherDeductions?: number;

  /** IGV (decimal). Por defecto 0.18 (18%). */
  igvRate?: number;

  /** Retención garantía fiel cumplimiento. */
  retentionPercentage: number;             // decimal (0.10 = 10%)
  retentionMode: "per_valuation" | "single";
  /** Monto contractual (solo se usa cuando retentionMode === "single"
   *  para calcular el monto único de retención sobre el contrato). */
  contractAmount?: number;
  /** Si retentionMode === "single", la retención total ya descontada en valorizaciones
   *  previas (para no volver a aplicarla). */
  retentionAlreadyRetained?: number;
}

export interface ValuationBreakdown {
  /** A — Costo directo (al monto contratado, post factor de relación) */
  directCost: number;
  /** B — Gastos generales */
  overhead: number;
  /** C — Utilidad */
  profit: number;
  /** A+B+C — Subtotal antes de reajuste */
  subtotal: number;
  /** Valorización contractual (subtotal "a expediente" × factor de relación) */
  contractualValuation: number;
  /** G — Reajuste bruto mensual (valorización × (K − 1)) */
  reajusteGross: number;
  /** H — Reintegro reajuste mes anterior */
  reajustePrevReintegro: number;
  /** I — Deducción de reajuste que no corresponde */
  reajusteDrnc: number;
  /** J — Subtotal reajustado = valorización + G + H − I */
  subtotalReajustado: number;
  /** Detalle de deducciones */
  amortDirectAdvance: number;
  amortMaterialsAdvance: number;
  dedDrncDirect: number;
  dedDrncMaterials: number;
  otherDeductions: number;
  /** K — Total deducciones */
  totalDeductions: number;
  /** L — Neto al contratista (J − K) */
  netToContractor: number;
  /** M = N — IGV */
  igvAmount: number;
  /** O — Total a facturar (L + N) */
  totalToInvoice: number;
  /** P — Retención garantía fiel cumplimiento */
  retentionAmount: number;
  /** Q — Monto a pagar al contratista (O − P) */
  netToPay: number;
}

const num = (v: number | undefined | null) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

export function computeValuationBreakdown(input: ValuationBreakdownInput): ValuationBreakdown {
  const dcRef = num(input.monthlyDirectCostAtReference);
  const ggPct = num(input.overheadPercentage);
  const utPct = num(input.profitPercentage);
  const relFactor = num(input.relationFactor) || 1;
  const k = num(input.reajusteK) || 1;
  const igvRate = input.igvRate ?? 0.18;

  // 1. Costo directo / GG / Utilidad — a valor referencial
  const overheadRef = dcRef * ggPct;
  const profitRef = dcRef * utPct;
  const subtotalRef = dcRef + overheadRef + profitRef;

  // 2. Llevar al monto contratado con el factor de relación
  const contractualValuation = subtotalRef * relFactor;

  // Para reportar A/B/C ya en términos contractuales (lo que se firma):
  const directCost = dcRef * relFactor;
  const overhead = overheadRef * relFactor;
  const profit = profitRef * relFactor;
  const subtotal = subtotalRef * relFactor;

  // 3. Reajuste
  const reajusteGross = contractualValuation * (k - 1);
  const reajustePrev = num(input.prevMonthReajusteReintegro);
  const reajusteDrnc = num(input.reajusteDrnc);
  const subtotalReajustado = contractualValuation + reajusteGross + reajustePrev - reajusteDrnc;

  // 4. Deducciones
  const amortDirect = num(input.amortDirectAdvance);
  const amortMaterials = num(input.amortMaterialsAdvance);
  const dedDrncDirect = num(input.dedDrncDirect);
  const dedDrncMaterials = num(input.dedDrncMaterials);
  const otherDeductions = num(input.otherDeductions);
  const totalDeductions = amortDirect + amortMaterials + dedDrncDirect + dedDrncMaterials + otherDeductions;

  // 5. Neto y facturación
  const netToContractor = subtotalReajustado - totalDeductions;
  const igvAmount = netToContractor * igvRate;
  const totalToInvoice = netToContractor + igvAmount;

  // 6. Retención garantía fiel cumplimiento
  let retentionAmount = 0;
  const retPct = num(input.retentionPercentage);
  if (retPct > 0) {
    if (input.retentionMode === "single") {
      const target = num(input.contractAmount) * retPct;
      const already = num(input.retentionAlreadyRetained);
      retentionAmount = Math.max(0, target - already);
    } else {
      // per_valuation: se aplica % sobre el subtotal reajustado de este período
      retentionAmount = subtotalReajustado * retPct;
    }
  }

  const netToPay = totalToInvoice - retentionAmount;

  return {
    directCost: round2(directCost),
    overhead: round2(overhead),
    profit: round2(profit),
    subtotal: round2(subtotal),
    contractualValuation: round2(contractualValuation),
    reajusteGross: round2(reajusteGross),
    reajustePrevReintegro: round2(reajustePrev),
    reajusteDrnc: round2(reajusteDrnc),
    subtotalReajustado: round2(subtotalReajustado),
    amortDirectAdvance: round2(amortDirect),
    amortMaterialsAdvance: round2(amortMaterials),
    dedDrncDirect: round2(dedDrncDirect),
    dedDrncMaterials: round2(dedDrncMaterials),
    otherDeductions: round2(otherDeductions),
    totalDeductions: round2(totalDeductions),
    netToContractor: round2(netToContractor),
    igvAmount: round2(igvAmount),
    totalToInvoice: round2(totalToInvoice),
    retentionAmount: round2(retentionAmount),
    netToPay: round2(netToPay),
  };
}

/** Etiquetas oficiales (A–Q) usadas en la hoja impresa. */
export const BREAKDOWN_ROWS = [
  { key: "directCost", letter: "A", label: "COSTO DIRECTO" },
  { key: "overhead", letter: "B", label: "GASTOS GENERALES" },
  { key: "profit", letter: "C", label: "UTILIDAD" },
  { key: "subtotal", letter: "", label: "SUBTOTAL (A+B+C)", emphasize: true },
  { key: "contractualValuation", letter: "", label: "Valorización contractual" },
  { key: "reajusteGross", letter: "G", label: "Reajuste bruto mensual" },
  { key: "reajustePrevReintegro", letter: "H", label: "Reintegro reajuste mes anterior" },
  { key: "reajusteDrnc", letter: "I", label: "Deducción reajuste que no corresponde (DRNC)" },
  { key: "subtotalReajustado", letter: "J", label: "SUBTOTAL REAJUSTADO (G+H−I)", emphasize: true },
  { key: "amortDirectAdvance", letter: "", label: "Amortización adelanto directo" },
  { key: "amortMaterialsAdvance", letter: "", label: "Amortización adelanto materiales" },
  { key: "dedDrncDirect", letter: "", label: "Deducción que no corresponde — adelanto directo" },
  { key: "dedDrncMaterials", letter: "", label: "Deducción que no corresponde — adelanto materiales" },
  { key: "otherDeductions", letter: "", label: "Otras deducciones" },
  { key: "totalDeductions", letter: "K", label: "TOTAL DEDUCCIONES", emphasize: true },
  { key: "netToContractor", letter: "L", label: "NETO AL CONTRATISTA (J−K)", emphasize: true },
  { key: "igvAmount", letter: "N", label: "IGV" },
  { key: "totalToInvoice", letter: "O", label: "TOTAL A FACTURAR (L+N)", emphasize: true },
  { key: "retentionAmount", letter: "P", label: "Retención garantía fiel cumplimiento" },
  { key: "netToPay", letter: "Q", label: "MONTO A PAGAR AL CONTRATISTA (O−P)", emphasize: true },
] as const;
