
-- Fase 1: Parámetros del formato peruano de valorización mensual (A–Q).

-- 1) PROJECTS: parámetros contractuales que aún no existen
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS overhead_percentage NUMERIC(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_percentage   NUMERIC(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS direct_advance_amount        NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS materials_advance_amount     NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS direct_advance_amortization_pct    NUMERIC(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS materials_advance_amortization_pct NUMERIC(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guarantee_retention_pct  NUMERIC(7,4) DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS guarantee_retention_mode TEXT DEFAULT 'per_valuation'
    CHECK (guarantee_retention_mode IN ('per_valuation','single')),
  ADD COLUMN IF NOT EXISTS reference_value_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS reference_value_date   DATE;

COMMENT ON COLUMN public.projects.overhead_percentage IS 'Gastos generales (%) sobre costo directo (0.08 = 8%)';
COMMENT ON COLUMN public.projects.profit_percentage IS 'Utilidad (%) sobre costo directo (0.07 = 7%)';
COMMENT ON COLUMN public.projects.guarantee_retention_pct IS 'Retención de garantía de fiel cumplimiento (0.10 = 10%)';
COMMENT ON COLUMN public.projects.guarantee_retention_mode IS 'per_valuation = se aplica en cada valorización; single = una sola vez';
COMMENT ON COLUMN public.projects.reference_value_amount IS 'Valor referencial incluido IGV (renglón "Valor Referencial" del formato)';
COMMENT ON COLUMN public.projects.reference_value_date IS 'Fecha del valor referencial (base para reajuste polinómico)';

-- 2) VALUATIONS: campos tipificados A–Q de la hoja de valorización
ALTER TABLE public.valuations
  ADD COLUMN IF NOT EXISTS direct_cost_amount      NUMERIC(14,2) DEFAULT 0, -- A
  ADD COLUMN IF NOT EXISTS overhead_amount         NUMERIC(14,2) DEFAULT 0, -- B
  ADD COLUMN IF NOT EXISTS profit_amount           NUMERIC(14,2) DEFAULT 0, -- C
  ADD COLUMN IF NOT EXISTS subtotal_amount         NUMERIC(14,2) DEFAULT 0, -- A+B+C
  ADD COLUMN IF NOT EXISTS reajuste_gross_amount   NUMERIC(14,2) DEFAULT 0, -- G
  ADD COLUMN IF NOT EXISTS reajuste_prev_reintegro NUMERIC(14,2) DEFAULT 0, -- H
  ADD COLUMN IF NOT EXISTS reajuste_drnc_amount    NUMERIC(14,2) DEFAULT 0, -- I
  ADD COLUMN IF NOT EXISTS subtotal_reajustado     NUMERIC(14,2) DEFAULT 0, -- J
  ADD COLUMN IF NOT EXISTS amort_direct_advance    NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amort_materials_advance NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ded_drnc_direct         NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ded_drnc_materials      NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deductions_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_deductions_amount NUMERIC(14,2) DEFAULT 0, -- K
  ADD COLUMN IF NOT EXISTS net_to_contractor       NUMERIC(14,2) DEFAULT 0, -- L
  ADD COLUMN IF NOT EXISTS igv_total_amount        NUMERIC(14,2) DEFAULT 0, -- N
  ADD COLUMN IF NOT EXISTS total_to_invoice        NUMERIC(14,2) DEFAULT 0, -- O
  ADD COLUMN IF NOT EXISTS retention_amount        NUMERIC(14,2) DEFAULT 0, -- P
  ADD COLUMN IF NOT EXISTS net_to_pay              NUMERIC(14,2) DEFAULT 0, -- Q
  ADD COLUMN IF NOT EXISTS prev_accumulated_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_accumulated_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reajuste_k_factor       NUMERIC(8,6);

COMMENT ON COLUMN public.valuations.direct_cost_amount IS 'A — Costo directo (suma de partidas valorizadas del mes)';
COMMENT ON COLUMN public.valuations.subtotal_amount IS 'A+B+C — Subtotal antes de reajuste';
COMMENT ON COLUMN public.valuations.reajuste_gross_amount IS 'G — Reajuste bruto mensual (K · monto)';
COMMENT ON COLUMN public.valuations.subtotal_reajustado IS 'J — Subtotal reajustado (G+H-I)';
COMMENT ON COLUMN public.valuations.total_deductions_amount IS 'K — Total deducciones (amortización adelantos + DRNC + otros)';
COMMENT ON COLUMN public.valuations.net_to_contractor IS 'L — Neto al contratista (J-K)';
COMMENT ON COLUMN public.valuations.total_to_invoice IS 'O — Total a facturar (L+N)';
COMMENT ON COLUMN public.valuations.retention_amount IS 'P — Retención garantía fiel cumplimiento';
COMMENT ON COLUMN public.valuations.net_to_pay IS 'Q — Monto a pagar al contratista (O-P)';
COMMENT ON COLUMN public.valuations.reajuste_k_factor IS 'Factor K aplicado en este período (proveniente del módulo de reajustes)';
