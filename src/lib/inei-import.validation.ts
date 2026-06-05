// Pure validation logic for the INEI CSV importer. Shared by the server
// function (src/lib/inei-import.functions.ts) and the unit tests.
// Keep these rules in sync with the client-side parser in
// src/components/app/reajustes-page.tsx (parseIndicesCsv).

export const PERIOD_RE = /^\d{4}-\d{2}-\d{2}$/;
export const CODE_RE = /^[A-Za-z0-9._-]+$/;

export type RawRow = {
  period_month: string;
  code: string;
  description?: string | null;
  value: number | string;
};

export type ValidRow = {
  period_month: string;
  code: string;
  description: string | null;
  value: number;
};

export type RowError = { line: number; field: string; message: string };

export function normalizePeriod(raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let y: number, mo: number, d: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    [y, mo, d] = v.split("-").map(Number);
  } else if (/^\d{4}-\d{2}$/.test(v)) {
    const [yy, mm] = v.split("-").map(Number);
    y = yy;
    mo = mm;
    d = 1;
  } else {
    const m1 = v.match(/^(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?$/);
    const m2 = v.match(/^(\d{1,2})[/-](\d{4})$/);
    if (m1) {
      y = +m1[1];
      mo = +m1[2];
      d = m1[3] ? +m1[3] : 1;
    } else if (m2) {
      y = +m2[2];
      mo = +m2[1];
      d = 1;
    } else return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2999) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

export function validateIneiRows(rows: RawRow[]): { valid: ValidRow[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const valid: ValidRow[] = [];
  const seenKey = new Map<string, number>();

  rows.forEach((raw, idx) => {
    const line = idx + 1;
    const rowErrs: RowError[] = [];

    const period = normalizePeriod(String(raw?.period_month ?? ""));
    if (!period || !PERIOD_RE.test(period)) {
      rowErrs.push({ line, field: "period_month", message: `Mes inválido: "${raw?.period_month ?? ""}".` });
    }

    const code = String(raw?.code ?? "").trim();
    if (!code) rowErrs.push({ line, field: "code", message: "Código vacío." });
    else if (code.length > 32) rowErrs.push({ line, field: "code", message: `Código demasiado largo (${code.length}>32).` });
    else if (!CODE_RE.test(code)) rowErrs.push({ line, field: "code", message: `Caracteres inválidos en código: "${code}".` });

    const description = raw?.description ? String(raw.description).trim() || null : null;
    if (description && description.length > 255) {
      rowErrs.push({ line, field: "description", message: `Descripción demasiado larga (${description.length}>255).` });
    }

    let value = NaN;
    const rawVal = typeof raw?.value === "number" ? String(raw.value) : String(raw?.value ?? "").trim();
    if (!rawVal) {
      rowErrs.push({ line, field: "value", message: "Valor vacío." });
    } else {
      const normalized = rawVal.replace(/\s/g, "").replace(",", ".");
      if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
        rowErrs.push({ line, field: "value", message: `Valor no numérico: "${rawVal}".` });
      } else {
        value = Number(normalized);
        if (!Number.isFinite(value)) rowErrs.push({ line, field: "value", message: `Valor fuera de rango.` });
        else if (value <= 0) rowErrs.push({ line, field: "value", message: `Valor debe ser mayor que 0.` });
        else if (value > 100000) rowErrs.push({ line, field: "value", message: `Valor sospechosamente alto (${value}).` });
      }
    }

    if (period && code && !rowErrs.some((e) => e.field === "period_month" || e.field === "code")) {
      const key = `${period}|${code}`;
      const prev = seenKey.get(key);
      if (prev !== undefined) {
        rowErrs.push({ line, field: "_row", message: `Duplicado intra-archivo de la línea ${prev}.` });
      } else {
        seenKey.set(key, line);
      }
    }

    if (rowErrs.length > 0) {
      errors.push(...rowErrs);
    } else {
      valid.push({ period_month: period!, code, description, value });
    }
  });

  return { valid, errors };
}
