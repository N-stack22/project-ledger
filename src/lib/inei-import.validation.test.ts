import { describe, it, expect } from "vitest";
import { validateIneiRows, normalizePeriod, type RawRow } from "./inei-import.validation";

describe("normalizePeriod", () => {
  it("acepta YYYY-MM-DD", () => {
    expect(normalizePeriod("2026-06-15")).toBe("2026-06-15");
  });
  it("acepta YYYY-MM y rellena día 01", () => {
    expect(normalizePeriod("2026-06")).toBe("2026-06-01");
  });
  it("acepta MM/YYYY", () => {
    expect(normalizePeriod("06/2026")).toBe("2026-06-01");
  });
  it("rechaza mes 13", () => {
    expect(normalizePeriod("2026-13")).toBeNull();
  });
  it("rechaza fecha calendario inválida", () => {
    expect(normalizePeriod("2026-02-30")).toBeNull();
  });
  it("rechaza string vacío o basura", () => {
    expect(normalizePeriod("")).toBeNull();
    expect(normalizePeriod("hola")).toBeNull();
  });
});

describe("validateIneiRows — caso válido", () => {
  it("acepta lote válido y normaliza period_month/value", () => {
    const rows: RawRow[] = [
      { period_month: "2026-06", code: "39", value: "123.45" },
      { period_month: "2026-06-01", code: "47", description: "Cemento", value: 200 },
      { period_month: "06/2026", code: "21", value: "1.234,56".replace("1.234,56", "1234.56") },
    ];
    const { valid, errors } = validateIneiRows(rows);
    expect(errors).toEqual([]);
    expect(valid).toHaveLength(3);
    expect(valid[0]).toEqual({ period_month: "2026-06-01", code: "39", description: null, value: 123.45 });
    expect(valid[1].description).toBe("Cemento");
    expect(valid[2].period_month).toBe("2026-06-01");
  });

  it("acepta valor con coma decimal", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "1234,56" },
    ]);
    expect(errors).toEqual([]);
    expect(valid[0].value).toBeCloseTo(1234.56, 2);
  });
});

describe("validateIneiRows — campos faltantes", () => {
  it("reporta period_month ausente", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "", code: "39", value: 100 } as RawRow,
    ]);
    expect(valid).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 1, field: "period_month" });
  });

  it("reporta code vacío", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "", value: 100 },
    ]);
    expect(errors.find((e) => e.field === "code")?.message).toBe("Código vacío.");
  });

  it("reporta value vacío", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "" },
    ]);
    expect(errors.find((e) => e.field === "value")?.message).toBe("Valor vacío.");
  });

  it("acumula múltiples errores por fila", () => {
    const { errors } = validateIneiRows([
      { period_month: "", code: "", value: "" },
    ]);
    const fields = errors.map((e) => e.field).sort();
    expect(fields).toEqual(["code", "period_month", "value"]);
  });
});

describe("validateIneiRows — formatos inválidos", () => {
  it("rechaza fecha mal formada", () => {
    const { errors } = validateIneiRows([
      { period_month: "junio 2026", code: "39", value: 100 },
    ]);
    expect(errors.some((e) => e.field === "period_month")).toBe(true);
  });

  it("rechaza caracteres inválidos en code", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39 cemento!", value: 100 },
    ]);
    expect(errors.find((e) => e.field === "code")?.message).toMatch(/Caracteres inválidos/);
  });

  it("rechaza code demasiado largo (>32)", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "X".repeat(33), value: 100 },
    ]);
    expect(errors.find((e) => e.field === "code")?.message).toMatch(/demasiado largo/);
  });

  it("rechaza description >255", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", description: "y".repeat(256), value: 100 },
    ]);
    expect(errors.find((e) => e.field === "description")).toBeDefined();
  });

  it("rechaza value no numérico", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "abc" },
    ]);
    expect(errors.find((e) => e.field === "value")?.message).toMatch(/no numérico/);
  });

  it("rechaza value <= 0", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: 0 },
      { period_month: "2026-06", code: "40", value: -5 },
    ]);
    expect(errors.filter((e) => e.field === "value")).toHaveLength(2);
  });

  it("rechaza value sospechosamente alto (>100000)", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: 999999 },
    ]);
    expect(errors.find((e) => e.field === "value")?.message).toMatch(/sospechosamente alto/);
  });
});

describe("validateIneiRows — duplicados", () => {
  it("detecta duplicado intra-archivo mismo (period, code)", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: 100 },
      { period_month: "2026-06-01", code: "39", value: 110 },
    ]);
    expect(valid).toHaveLength(1);
    const dup = errors.find((e) => e.field === "_row");
    expect(dup).toBeDefined();
    expect(dup!.line).toBe(2);
    expect(dup!.message).toMatch(/línea 1/);
  });

  it("permite mismo code en distintos periodos", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: 100 },
      { period_month: "2026-07", code: "39", value: 110 },
    ]);
    expect(errors).toEqual([]);
    expect(valid).toHaveLength(2);
  });
});

describe("validateIneiRows — lote mixto", () => {
  it("separa válidas e inválidas conservando numeración de líneas", () => {
    const rows: RawRow[] = [
      { period_month: "2026-06", code: "39", value: 100 },       // 1 ok
      { period_month: "bad", code: "40", value: 50 },             // 2 period bad
      { period_month: "2026-06", code: "41", value: "x" },        // 3 value bad
      { period_month: "2026-06", code: "39", value: 999 },        // 4 duplicado de 1
      { period_month: "2026-07", code: "42", value: 75 },         // 5 ok
    ];
    const { valid, errors } = validateIneiRows(rows);
    expect(valid.map((v) => v.code)).toEqual(["39", "42"]);
    expect(errors.map((e) => e.line).sort()).toEqual([2, 3, 4]);
    expect(errors.find((e) => e.line === 2)?.field).toBe("period_month");
    expect(errors.find((e) => e.line === 3)?.field).toBe("value");
    expect(errors.find((e) => e.line === 4)?.field).toBe("_row");
  });

  it("lote vacío produce sin errores y sin filas válidas", () => {
    const { valid, errors } = validateIneiRows([]);
    expect(valid).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("validateIneiRows — espacios en blanco extremos", () => {
  it("trimea espacios alrededor de code y description", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "  2026-06  ", code: "  39  ", description: "  Cemento  ", value: "  123.45  " },
    ]);
    expect(errors).toEqual([]);
    expect(valid[0]).toEqual({ period_month: "2026-06-01", code: "39", description: "Cemento", value: 123.45 });
  });

  it("rechaza code que es sólo espacios", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "   ", value: 100 },
    ]);
    expect(errors.find((e) => e.field === "code")?.message).toBe("Código vacío.");
  });

  it("rechaza value que es sólo espacios", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "   " },
    ]);
    expect(errors.find((e) => e.field === "value")?.message).toBe("Valor vacío.");
  });

  it("rechaza code con espacios internos", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39 40", value: 100 },
    ]);
    expect(errors.find((e) => e.field === "code")?.message).toMatch(/Caracteres inválidos/);
  });

  it("permite value con espacios internos (se eliminan)", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "1 234.56" },
    ]);
    expect(errors).toEqual([]);
    expect(valid[0].value).toBeCloseTo(1234.56, 2);
  });

  it("trata description compuesta sólo de espacios como null", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", description: "    ", value: 100 },
    ]);
    expect(errors).toEqual([]);
    expect(valid[0].description).toBeNull();
  });
});

describe("validateIneiRows — caracteres no permitidos en code", () => {
  const invalidCodes = ["39$", "39/40", "39 40", "código", "39:01", "39@", "39+", "39*", "39\t", "ñ-1"];
  invalidCodes.forEach((bad) => {
    it(`rechaza code "${bad.replace(/\s/g, "·")}"`, () => {
      const { errors, valid } = validateIneiRows([{ period_month: "2026-06", code: bad, value: 100 }]);
      expect(valid).toEqual([]);
      expect(errors.find((e) => e.field === "code")).toBeDefined();
    });
  });

  it("acepta sólo letras, dígitos, punto, guion y guion bajo", () => {
    const { errors, valid } = validateIneiRows([
      { period_month: "2026-06", code: "ABC.39_a-1", value: 100 },
    ]);
    expect(errors).toEqual([]);
    expect(valid).toHaveLength(1);
  });
});

describe("validateIneiRows — separadores decimales mixtos", () => {
  it("acepta punto como separador decimal", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "1234.56" },
    ]);
    expect(errors).toEqual([]);
    expect(valid[0].value).toBeCloseTo(1234.56, 2);
  });

  it("acepta coma como separador decimal", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "1234,56" },
    ]);
    expect(errors).toEqual([]);
    expect(valid[0].value).toBeCloseTo(1234.56, 2);
  });

  it("rechaza coma de miles + coma decimal (1,234,56)", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "1,234,56" },
    ]);
    expect(errors.find((e) => e.field === "value")?.message).toMatch(/no numérico/);
  });

  it("rechaza punto de miles con coma decimal (1.234,56)", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "1.234,56" },
    ]);
    expect(errors.find((e) => e.field === "value")?.message).toMatch(/no numérico/);
  });

  it("rechaza notación científica", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "1e3" },
    ]);
    expect(errors.find((e) => e.field === "value")?.message).toMatch(/no numérico/);
  });

  it("rechaza valores con sufijo no numérico", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "100abc" },
    ]);
    expect(errors.find((e) => e.field === "value")?.message).toMatch(/no numérico/);
  });

  it("acepta entero sin decimales", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "100" },
    ]);
    expect(errors).toEqual([]);
    expect(valid[0].value).toBe(100);
  });

  it("acepta value justo en el límite superior (100000)", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: 100000 },
    ]);
    expect(errors).toEqual([]);
    expect(valid[0].value).toBe(100000);
  });

  it("rechaza value apenas por encima del límite (100000.01)", () => {
    const { errors } = validateIneiRows([
      { period_month: "2026-06", code: "39", value: "100000.01" },
    ]);
    expect(errors.find((e) => e.field === "value")?.message).toMatch(/sospechosamente alto/);
  });
});

describe("validateIneiRows — period_month en formatos límite", () => {
  it("acepta año mínimo válido (1900)", () => {
    expect(normalizePeriod("1900-01-01")).toBe("1900-01-01");
  });

  it("rechaza año por debajo del rango (1899)", () => {
    expect(normalizePeriod("1899-12")).toBeNull();
  });

  it("acepta año máximo válido (2999-12-31)", () => {
    expect(normalizePeriod("2999-12-31")).toBe("2999-12-31");
  });

  it("rechaza año por encima del rango (3000)", () => {
    expect(normalizePeriod("3000-01")).toBeNull();
  });

  it("acepta 29 de febrero en año bisiesto", () => {
    expect(normalizePeriod("2024-02-29")).toBe("2024-02-29");
  });

  it("rechaza 29 de febrero en año no bisiesto", () => {
    expect(normalizePeriod("2023-02-29")).toBeNull();
  });

  it("rechaza día 31 en mes de 30 días", () => {
    expect(normalizePeriod("2026-04-31")).toBeNull();
  });

  it("acepta formato YYYY/MM/DD con barras", () => {
    expect(normalizePeriod("2026/06/15")).toBe("2026-06-15");
  });

  it("acepta MM-YYYY con guion", () => {
    expect(normalizePeriod("06-2026")).toBe("2026-06-01");
  });

  it("acepta M/YYYY (un solo dígito de mes)", () => {
    expect(normalizePeriod("6/2026")).toBe("2026-06-01");
  });

  it("rechaza mes 00", () => {
    expect(normalizePeriod("2026-00")).toBeNull();
  });

  it("rechaza día 00", () => {
    expect(normalizePeriod("2026-06-00")).toBeNull();
  });

  it("rechaza fecha con texto adicional", () => {
    expect(normalizePeriod("2026-06-01 extra")).toBeNull();
  });

  it("propaga rechazo de período límite por fila", () => {
    const { valid, errors } = validateIneiRows([
      { period_month: "1899-12", code: "39", value: 100 },
      { period_month: "1900-01", code: "39", value: 100 },
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0].period_month).toBe("1900-01-01");
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("period_month");
  });
});
