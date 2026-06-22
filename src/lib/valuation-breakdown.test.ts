import { describe, expect, it } from "vitest";
import { computeValuationBreakdown } from "./valuation-breakdown";

/**
 * Caso de referencia: Valorización N° 01 (Oct 2018) — Rehabilitación Calle Oriente, Chiclayo.
 * Datos extraídos del informe mensual de avance de obra:
 *   - Subtotal a valor referencial (A+B+C): 81,099.21
 *   - Factor de relación:                  0.90000  →  Valorización contractual = 72,989.29
 *   - K aplicado (octubre-18):              ~1.03243  →  Reajuste bruto = 2,366.99
 *   - Subtotal reajustado (J):             75,356.28
 *   - Sin deducciones ni adelantos
 *   - IGV 18% → Total a facturar = 88,920.41
 *   - Retención 10% única del monto contratado (333,879.93) = 33,387.99
 *   - Neto a pagar (Q) = 55,532.42
 */
describe("computeValuationBreakdown — caso PDF Chiclayo Oct-2018", () => {
  const r = computeValuationBreakdown({
    // 81,099.21 = costo directo (70,521.06) × (1 + 0.08 + 0.07) → DC ref = 70,521.06
    monthlyDirectCostAtReference: 70_521.06,
    overheadPercentage: 5_641.68 / 70_521.06, // exacta para reproducir GG = 5,641.68
    profitPercentage: 4_936.47 / 70_521.06,    // exacta para reproducir Utilidad = 4,936.47
    relationFactor: 0.9,
    reajusteK: 1 + 2_366.99 / 72_989.29,       // implica G = 2,366.99
    igvRate: 0.18,
    retentionPercentage: 0.1,
    retentionMode: "single",
    contractAmount: 333_879.93,
    retentionAlreadyRetained: 0,
  });

  it("subtotal A+B+C contractual = 72,989.29", () => {
    expect(r.subtotal).toBeCloseTo(72_989.29, 1);
    expect(r.contractualValuation).toBeCloseTo(72_989.29, 1);
  });

  it("reajuste bruto G ≈ 2,366.99", () => {
    expect(r.reajusteGross).toBeCloseTo(2_366.99, 1);
  });

  it("subtotal reajustado J = 75,356.28", () => {
    expect(r.subtotalReajustado).toBeCloseTo(75_356.28, 1);
  });

  it("neto al contratista L = 75,356.28 (sin deducciones)", () => {
    expect(r.netToContractor).toBeCloseTo(75_356.28, 1);
  });

  it("IGV ≈ 13,564.13 y total a facturar O ≈ 88,920.41", () => {
    expect(r.igvAmount).toBeCloseTo(13_564.13, 1);
    expect(r.totalToInvoice).toBeCloseTo(88_920.41, 1);
  });

  it("retención única P = 33,387.99 y neto a pagar Q = 55,532.42", () => {
    expect(r.retentionAmount).toBeCloseTo(33_387.99, 1);
    expect(r.netToPay).toBeCloseTo(55_532.42, 1);
  });
});

describe("computeValuationBreakdown — retención per_valuation", () => {
  it("aplica 10% sobre el subtotal reajustado del período", () => {
    const r = computeValuationBreakdown({
      monthlyDirectCostAtReference: 10_000,
      overheadPercentage: 0,
      profitPercentage: 0,
      relationFactor: 1,
      reajusteK: 1,
      retentionPercentage: 0.1,
      retentionMode: "per_valuation",
    });
    expect(r.subtotalReajustado).toBeCloseTo(10_000, 2);
    expect(r.retentionAmount).toBeCloseTo(1_000, 2);
  });
});

describe("computeValuationBreakdown — deducciones tipificadas", () => {
  it("suma todos los rubros en K", () => {
    const r = computeValuationBreakdown({
      monthlyDirectCostAtReference: 100_000,
      overheadPercentage: 0,
      profitPercentage: 0,
      relationFactor: 1,
      reajusteK: 1,
      retentionPercentage: 0,
      retentionMode: "per_valuation",
      amortDirectAdvance: 1_000,
      amortMaterialsAdvance: 2_000,
      dedDrncDirect: 500,
      dedDrncMaterials: 300,
      otherDeductions: 200,
    });
    expect(r.totalDeductions).toBeCloseTo(4_000, 2);
    expect(r.netToContractor).toBeCloseTo(96_000, 2);
  });
});
