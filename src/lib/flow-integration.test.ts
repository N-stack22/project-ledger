import { describe, it, expect } from "vitest";
import {
  computeLinePartial,
  buildValuationTable,
  buildParentCodeSet,
  isLeafByCode,
  totals,
} from "./expediente";
import {
  calculateValuationFromData,
  calculateProjectProgress,
  buildDashboardMetrics,
} from "./business";
import type { ProjectRow, ValuationRow, MemoriaRow, BudgetItemRow, MetradoEntryRow } from "./domain";

// Helpers — minimal partial stubs cast to row types
const makeProject = (over: Partial<ProjectRow> = {}): ProjectRow =>
  ({
    id: "proj-1",
    contract_type: "precios_unitarios",
    contract_amount: 100000,
    progress_percent: 0,
    status: "active",
    ...over,
  }) as ProjectRow;

const makeItem = (id: string, code: string, qty: number, price: number): BudgetItemRow =>
  ({
    id,
    item_code: code,
    description: `Partida ${code}`,
    unit: "m3",
    base_quantity: qty,
    unit_price: price,
    partial_amount: qty * price,
    sort_order: Number(code.replace(/\D/g, "")) || 0,
  }) as unknown as BudgetItemRow;

const makeMetradoEntry = (id: string, item_id: string, qty: number): MetradoEntryRow =>
  ({ id, item_id, quantity: qty }) as unknown as MetradoEntryRow;

describe("Integración: flujo memoria → valorización → liquidación", () => {
  it("calcula partial geométrico de líneas de metrado", () => {
    expect(computeLinePartial({ num_elements: 2, length: 5, width: 3, height: null, formula: null })).toBe(30);
    expect(computeLinePartial({ num_elements: 1, length: 10, width: null, height: null, formula: "L*2" })).toBe(20);
  });

  it("construye el cuadro de valorización con avance del período", () => {
    const items = [makeItem("i1", "01.01", 100, 10), makeItem("i2", "01.02", 50, 20)];
    const rows = buildValuationTable({
      items,
      previousLines: [{ id: "p1", item_id: "i1", partial: 30 } as never],
      currentLines: [
        { id: "c1", item_id: "i1", partial: 20 } as never,
        { id: "c2", item_id: "i2", partial: 10 } as never,
      ],
    });
    const r1 = rows.find((r) => r.item.id === "i1")!;
    expect(r1.qtyPrev).toBe(30);
    expect(r1.qtyCurrent).toBe(20);
    expect(r1.qtyAccum).toBe(50);
    expect(r1.amountCurrent).toBe(200);
    expect(r1.pctAccum).toBe(50);

    const t = totals(rows);
    expect(t.current).toBe(200 + 200); // 20*10 + 10*20
    expect(t.accum).toBe(500 + 200);
  });

  it("identifica hojas estructurales correctamente", () => {
    const items = [
      { item_code: "01" },
      { item_code: "01.01" },
      { item_code: "01.02" },
      { item_code: "02" },
    ];
    const parents = buildParentCodeSet(items);
    expect(parents.has("01")).toBe(true);
    expect(isLeafByCode("01.01", parents)).toBe(true);
    expect(isLeafByCode("01", parents)).toBe(false);
    expect(isLeafByCode("02", parents)).toBe(true);
  });

  it("propaga: valorización aprobada → avance del proyecto → dashboard", () => {
    const project = makeProject({ contract_amount: 100000 });
    const metrados = [makeMetradoEntry("m1", "i1", 20), makeMetradoEntry("m2", "i2", 10)];
    const items = [
      { item_id: "i1", quantity: 20, unit_price: 1000 },
      { item_id: "i2", quantity: 10, unit_price: 2000 },
    ];

    const val = calculateValuationFromData({ project, metrados, items });
    expect(val.grossAmount).toBe(40000);
    expect(val.progressPercent).toBe(40);

    const approvedValuation: ValuationRow = {
      id: "v1",
      project_id: project.id,
      status: "approved",
      net_amount: val.grossAmount,
      progress_percent: val.progressPercent,
    } as unknown as ValuationRow;

    const progress = calculateProjectProgress(project, [approvedValuation]);
    expect(progress).toBe(40);

    const memorias: MemoriaRow[] = [
      { id: "mem1", project_id: project.id, status: "approved" } as unknown as MemoriaRow,
    ];
    const metrics = buildDashboardMetrics([project], [approvedValuation], memorias);
    expect(metrics[0].value).toBe("1"); // proyecto activo
    expect(metrics[1].value).toContain("40,000"); // valorizado aprobado
    expect(metrics[2].value).toBe("1"); // memorias aprobadas
  });

  it("suma alzada: progreso = max(% aprobado), valorización proporcional al contrato", () => {
    const project = makeProject({ contract_type: "suma_alzada", contract_amount: 200000 });
    const v1 = calculateValuationFromData({ project, metrados: [], items: [], progressPercent: 25 });
    expect(v1.grossAmount).toBe(50000);

    const approved: ValuationRow[] = [
      { id: "a", project_id: project.id, status: "approved", net_amount: 50000, progress_percent: 25 } as unknown as ValuationRow,
      { id: "b", project_id: project.id, status: "approved", net_amount: 100000, progress_percent: 60 } as unknown as ValuationRow,
    ];
    expect(calculateProjectProgress(project, approved)).toBe(60);
  });

  it("liquidación: cap al 100% incluso si net_amount supera el contrato", () => {
    const project = makeProject({ contract_amount: 50000 });
    const valuations: ValuationRow[] = [
      { id: "v1", project_id: project.id, status: "approved", net_amount: 75000, progress_percent: 100 } as unknown as ValuationRow,
    ];
    expect(calculateProjectProgress(project, valuations)).toBe(100);
  });
});
