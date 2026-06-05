import { describe, it, expect } from "vitest";
import { calcReajuste, isFormulaBalanced, type Monomio } from "./reajuste";

const monomios: Monomio[] = [
  { symbol: "a", coefficient: 0.4, index_code: "39", base_index_value: 100 },
  { symbol: "b", coefficient: 0.3, index_code: "47", base_index_value: 200 },
  { symbol: "c", coefficient: 0.3, index_code: "21", base_index_value: 150 },
];

describe("calcReajuste", () => {
  it("calcula K=1 cuando los índices actuales son iguales a los base", () => {
    const r = calcReajuste(monomios, [
      { code: "39", value: 100 },
      { code: "47", value: 200 },
      { code: "21", value: 150 },
    ], 10000);
    expect(r.k).toBeCloseTo(1, 6);
    expect(r.reajusteAmount).toBeCloseTo(0, 2);
    expect(r.totalCoeff).toBeCloseTo(1, 6);
  });

  it("K > 1 produce reajuste positivo", () => {
    const r = calcReajuste(monomios, [
      { code: "39", value: 110 }, // +10%
      { code: "47", value: 220 }, // +10%
      { code: "21", value: 165 }, // +10%
    ], 10000);
    expect(r.k).toBeCloseTo(1.1, 6);
    expect(r.reajusteAmount).toBeCloseTo(1000, 2);
  });

  it("K < 1 produce reajuste negativo", () => {
    const r = calcReajuste(monomios, [
      { code: "39", value: 90 },
      { code: "47", value: 180 },
      { code: "21", value: 135 },
    ], 10000);
    expect(r.k).toBeCloseTo(0.9, 6);
    expect(r.reajusteAmount).toBeCloseTo(-1000, 2);
  });

  it("marca índices faltantes como missing y no los suma a K", () => {
    const r = calcReajuste(monomios, [
      { code: "39", value: 110 },
      { code: "47", value: 220 },
      // falta 21
    ], 10000);
    expect(r.detail.find((d) => d.symbol === "c")?.missing).toBe(true);
    expect(r.k).toBeCloseTo(0.4 * 1.1 + 0.3 * 1.1, 6);
  });

  it("ignora monomios con Ioi=0", () => {
    const r = calcReajuste(
      [{ symbol: "z", coefficient: 1, index_code: "X", base_index_value: 0 }],
      [{ code: "X", value: 500 }],
      1000,
    );
    expect(r.k).toBe(0);
    expect(r.detail[0].missing).toBe(true);
  });

  it("base 0 produce reajuste 0", () => {
    const r = calcReajuste(monomios, [
      { code: "39", value: 110 }, { code: "47", value: 220 }, { code: "21", value: 165 },
    ], 0);
    expect(r.reajusteAmount).toBe(0);
  });
});

describe("isFormulaBalanced", () => {
  it("acepta suma 1.000", () => {
    expect(isFormulaBalanced(monomios)).toBe(true);
  });
  it("rechaza suma distinta de 1", () => {
    expect(isFormulaBalanced([{ symbol: "a", coefficient: 0.5, index_code: "1", base_index_value: 100 }])).toBe(false);
  });
  it("tolerancia configurable", () => {
    const m: Monomio[] = [{ symbol: "a", coefficient: 1.0005, index_code: "1", base_index_value: 100 }];
    expect(isFormulaBalanced(m, 0.001)).toBe(true);
    expect(isFormulaBalanced(m, 0.0001)).toBe(false);
  });
});
