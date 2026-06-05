import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { detectBudgetWorkbook } from "./business";

function makeFile(rows: (string | number | null)[][]): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Presupuesto");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], "presupuesto.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("detectBudgetWorkbook", () => {
  it("detecta encabezados estándar y parsea filas válidas", async () => {
    const file = makeFile([
      ["Presupuesto de Obra"],
      ["Item", "Descripción", "Und.", "Metrado", "Precio Unitario", "Parcial"],
      ["01.01", "Excavación manual", "m3", 120, 35.5, 4260],
      ["01.02", "Concreto f'c=210", "m3", 50, 420, 21000],
    ]);
    const result = await detectBudgetWorkbook(file);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].description).toBe("Excavación manual");
    expect(result.rows[0].unit).toBe("m3");
    expect(result.rows[0].base_quantity).toBe(120);
    expect(result.rows[0].unit_price).toBe(35.5);
    expect(result.rows[1].partial_amount).toBe(21000);
    expect(result.mapping.description).toBeTruthy();
    expect(result.mapping.unit_price).toBeTruthy();
  });

  it("calcula parcial cuando falta la columna", async () => {
    const file = makeFile([
      ["Item", "Descripción", "Unidad", "Cantidad", "Precio"],
      ["1", "Acero", "kg", 10, 5],
    ]);
    const result = await detectBudgetWorkbook(file);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].partial_amount).toBe(50);
  });

  it("acepta filas padre sin unidad/precio (jerarquía)", async () => {
    const file = makeFile([
      ["Item", "Descripción", "Und.", "Metrado", "Precio Unitario"],
      ["01", "ESTRUCTURAS", "", 0, 0],
      ["01.01", "Zapatas", "m3", 10, 200],
    ]);
    const result = await detectBudgetWorkbook(file);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].description).toBe("ESTRUCTURAS");
    expect(result.rows[0].unit).toBe("");
    expect(result.rows[1].unit).toBe("m3");
  });

  it("devuelve warning si no encuentra encabezados", async () => {
    const file = makeFile([
      ["solo", "texto", "aleatorio"],
      ["sin", "estructura", "tabular"],
    ]);
    const result = await detectBudgetWorkbook(file);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("ignora filas vacías o sin descripción", async () => {
    const file = makeFile([
      ["Item", "Descripción", "Und.", "Metrado", "Precio Unitario"],
      ["01.01", "Partida real", "m3", 5, 100],
      ["", "", "", null, null],
      ["02", "...", "m", 1, 1],
    ]);
    const result = await detectBudgetWorkbook(file);
    expect(result.rows.map((r) => r.description)).toEqual(["Partida real"]);
  });
});
