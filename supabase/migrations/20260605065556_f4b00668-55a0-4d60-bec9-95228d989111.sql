
-- INEI Indices catalog
CREATE TABLE public.inei_indices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_month DATE NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  value NUMERIC(14,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_month, code)
);
GRANT SELECT ON public.inei_indices TO authenticated;
GRANT ALL ON public.inei_indices TO service_role;
ALTER TABLE public.inei_indices ENABLE ROW LEVEL SECURITY;

CREATE POLICY inei_indices_view ON public.inei_indices
  FOR SELECT TO authenticated USING (true);
CREATE POLICY inei_indices_admin_insert ON public.inei_indices
  FOR INSERT TO authenticated
  WITH CHECK (public.is_global_admin(auth.uid()));
CREATE POLICY inei_indices_admin_update ON public.inei_indices
  FOR UPDATE TO authenticated
  USING (public.is_global_admin(auth.uid()))
  WITH CHECK (public.is_global_admin(auth.uid()));
CREATE POLICY inei_indices_admin_delete ON public.inei_indices
  FOR DELETE TO authenticated
  USING (public.is_global_admin(auth.uid()));

CREATE TRIGGER trg_inei_indices_updated_at
  BEFORE UPDATE ON public.inei_indices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Polynomial formulas per project
CREATE TABLE public.polynomial_formulas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  name TEXT NOT NULL,
  base_period_month DATE NOT NULL,
  monomios JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.polynomial_formulas TO authenticated;
GRANT ALL ON public.polynomial_formulas TO service_role;
ALTER TABLE public.polynomial_formulas ENABLE ROW LEVEL SECURITY;

CREATE POLICY polynomial_formulas_view ON public.polynomial_formulas
  FOR SELECT TO authenticated
  USING (public.can_view_project(project_id, auth.uid()));
CREATE POLICY polynomial_formulas_insert ON public.polynomial_formulas
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_project_data(project_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY polynomial_formulas_update ON public.polynomial_formulas
  FOR UPDATE TO authenticated
  USING (public.can_edit_project_data(project_id, auth.uid()))
  WITH CHECK (public.can_edit_project_data(project_id, auth.uid()));
CREATE POLICY polynomial_formulas_delete ON public.polynomial_formulas
  FOR DELETE TO authenticated
  USING (public.can_edit_project_data(project_id, auth.uid()));

CREATE TRIGGER trg_polynomial_formulas_updated_at
  BEFORE UPDATE ON public.polynomial_formulas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reajuste calculations per period
CREATE TABLE public.reajustes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  formula_id UUID NOT NULL REFERENCES public.polynomial_formulas(id) ON DELETE RESTRICT,
  period_month DATE NOT NULL,
  base_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  k_value NUMERIC(14,6) NOT NULL DEFAULT 0,
  reajuste_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reajustes TO authenticated;
GRANT ALL ON public.reajustes TO service_role;
ALTER TABLE public.reajustes ENABLE ROW LEVEL SECURITY;

CREATE POLICY reajustes_view ON public.reajustes
  FOR SELECT TO authenticated
  USING (public.can_view_project(project_id, auth.uid()));
CREATE POLICY reajustes_insert ON public.reajustes
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_project_data(project_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY reajustes_update ON public.reajustes
  FOR UPDATE TO authenticated
  USING (public.can_edit_project_data(project_id, auth.uid()))
  WITH CHECK (public.can_edit_project_data(project_id, auth.uid()));
CREATE POLICY reajustes_delete ON public.reajustes
  FOR DELETE TO authenticated
  USING (public.is_global_admin(auth.uid()));

CREATE TRIGGER trg_reajustes_updated_at
  BEFORE UPDATE ON public.reajustes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_reajustes_project ON public.reajustes(project_id, period_month);
CREATE INDEX idx_polynomial_formulas_project ON public.polynomial_formulas(project_id);
CREATE INDEX idx_inei_indices_period ON public.inei_indices(period_month);
