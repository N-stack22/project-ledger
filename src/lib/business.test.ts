import { describe, it, expect } from "vitest";
import {
  calculateProjectProgress,
  calculateValuationFromData,
  buildAuditSummary,
  toPeriodDate,
} from "./business";
import type { ProjectRow, ValuationRow } from "./domain";

const baseProject = (over: Partial<ProjectRow> = {}): ProjectRow => ({
  id: "p1",
  code: "P-001",
  name: "Test",
  client_name: null, location: null, description: null,
  contract_type: "precios_unitarios",
  contract_amount: 100000,
  currency_code: "PEN",
  start_date: null, planned_end_date: null, actual_end_date: null,
  started_at: null,
  status: "active",
  progress_percent: 0,
  created_by: null, created_at: "2026-01-01", updated_at: "2026-01-01",
  district: null, supervisor_name: null, resident_name: null, subgerente_name: null,
  supervision_contract: null, execution_contract: null, contractor_name: null,
  execution_modality: null, executing_unit: null, entity_name: null,
  extensions_days: 0, deductives_amount: 0, additionals_amount: 0, igv_amount: 0,
  utility_amount: 0, overhead_cost: 0, direct_cost: 0, expediente_amount: 0,
  new_completion_date: null, planned_completion_date: null, execution_term_days: null,
  site_handover_date: null, department: null, province: null,
  ...over,
} as any);

const baseValuation = (over: Partial<ValuationRow> = {}): ValuationRow => ({
  id: "v1",
  project_id: "p1",
  memoria_id: "m1",
  period_month: "2026-01-01",
  contract_type_snapshot: "precios_unitarios",
  total_quantity: 0,
  progress_percent: 0,
  gross_amount: 0,
  deductions_amount: 0,
  net_amount: 0,
  status: "approved",
  resident_reviewed_by: null, resident_reviewed_at: null,
  supervisor_reviewed_by: null, supervisor_reviewed_at: null,
  supervisor_comment: null, generated_document_path: null,
  created_by: "u1", created_at: "2026-01-01", updated_at: "2026-01-01",
  ...over,
} as any);

describe("calculateProjectProgress", () => {
  it("devuelve progress_percent del proyecto si no hay valorizaciones aprobadas", () => {
    expect(calculateProjectProgress(baseProject({ progress_percent: 12 }), [])).toBe(12);
  });

  it("precios unitarios: suma neta / monto contractual", () => {
    const p = baseProject({ contract_amount: 100000 });
    const vs = [baseValuation({ net_amount: 25000 }), baseValuation({ id: "v2", net_amount: 25000 })];
    expect(calculateProjectProgress(p, vs)).toBeCloseTo(50, 4);
  });

  it("precios unitarios: tope al 100%", () => {
    const p = baseProject({ contract_amount: 100 });
    const vs = [baseValuation({ net_amount: 500 })];
    expect(calculateProjectProgress(p, vs)).toBe(100);
  });

  it("suma alzada: máximo del progress_percent aprobado", () => {
    const p = baseProject({ contract_type: "suma_alzada" });
    const vs = [
      baseValuation({ progress_percent: 30 }),
      baseValuation({ id: "v2", progress_percent: 65 }),
    ];
    expect(calculateProjectProgress(p, vs)).toBe(65);
  });

  it("ignora valorizaciones no aprobadas", () => {
    const p = baseProject({ contract_amount: 100000 });
    const vs = [baseValuation({ net_amount: 25000, status: "pending" })];
    expect(calculateProjectProgress(p, vs)).toBe(0);
  });
});

describe("calculateValuationFromData", () => {
  it("precios unitarios: suma cantidad × precio", () => {
    const r = calculateValuationFromData({
      project: baseProject({ contract_amount: 1000 }),
      metrados: [{ quantity: 10 } as any, { quantity: 5 } as any],
      items: [{ item_id: "i1", quantity: 10, unit_price: 50 }],
    });
    expect(r.totalQuantity).toBe(15);
    expect(r.grossAmount).toBe(500);
    expect(r.progressPercent).toBe(50);
  });

  it("suma alzada: monto = contractAmount × progress%", () => {
    const r = calculateValuationFromData({
      project: baseProject({ contract_type: "suma_alzada", contract_amount: 10000 }),
      metrados: [],
      items: [],
      progressPercent: 25,
    });
    expect(r.grossAmount).toBe(2500);
    expect(r.progressPercent).toBe(25);
  });

  it("acepta valuation_lines (quantity_period / unit_price_applied)", () => {
    const r = calculateValuationFromData({
      project: baseProject(),
      metrados: [],
      items: [
        { quantity_period: 4, unit_price_applied: 25 } as any,
        { quantity_period: 2, unit_price_applied: 10 } as any,
      ],
    });
    expect(r.grossAmount).toBe(120);
  });
});

describe("toPeriodDate", () => {
  it("normaliza al primer día del mes (UTC)", () => {
    expect(toPeriodDate("2026-03-17")).toBe("2026-03-01");
    expect(toPeriodDate("2026-12-31")).toBe("2026-12-01");
  });
});

describe("buildAuditSummary", () => {
  it("mapea acciones a etiquetas y entity", () => {
    const out = buildAuditSummary([
      { action: "INSERT", created_at: "2026-01-01T00:00:00Z", entity_type: "projects", actor_user_id: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveProperty("action");
    expect(out[0]).toHaveProperty("entity");
  });
});
