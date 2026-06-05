export interface Monomio {
  symbol: string;
  coefficient: number;
  index_code: string;
  base_index_value: number;
}

export interface IndexValue {
  code: string;
  value: number;
}

export interface ReajusteResult {
  k: number;
  totalCoeff: number;
  reajusteAmount: number;
  detail: Array<{
    symbol: string;
    coeff: number;
    Ii: number;
    Ioi: number;
    ratio: number;
    term: number;
    missing: boolean;
  }>;
}

/**
 * Calcula K = Σ (coef_i × Ii / Ioi) y el monto de reajuste = base × (K − 1).
 * Si falta un índice del período, el monomio aporta 0 y se marca `missing`.
 */
export function calcReajuste(
  monomios: Monomio[],
  periodIndices: IndexValue[],
  baseAmount: number,
): ReajusteResult {
  let k = 0;
  let totalCoeff = 0;
  const detail: ReajusteResult["detail"] = [];

  for (const m of monomios) {
    const coeff = Number(m.coefficient) || 0;
    totalCoeff += coeff;
    const Ioi = Number(m.base_index_value) || 0;
    const found = periodIndices.find((i) => i.code === m.index_code);
    if (!found || !Ioi) {
      detail.push({ symbol: m.symbol, coeff, Ii: 0, Ioi, ratio: 0, term: 0, missing: true });
      continue;
    }
    const Ii = Number(found.value);
    const ratio = Ii / Ioi;
    const term = coeff * ratio;
    k += term;
    detail.push({ symbol: m.symbol, coeff, Ii, Ioi, ratio, term, missing: false });
  }

  const base = Number(baseAmount) || 0;
  return { k, totalCoeff, reajusteAmount: base * (k - 1), detail };
}

/** Suma de coeficientes debe ser 1.000 (tolerancia 0.001). */
export function isFormulaBalanced(monomios: Monomio[], tolerance = 0.001) {
  const sum = monomios.reduce((s, m) => s + (Number(m.coefficient) || 0), 0);
  return Math.abs(sum - 1) <= tolerance;
}
