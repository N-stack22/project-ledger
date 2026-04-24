-- =========================================
-- 1. Extender projects con ficha técnica
-- =========================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS entity_name text,
  ADD COLUMN IF NOT EXISTS executing_unit text,
  ADD COLUMN IF NOT EXISTS execution_modality text,
  ADD COLUMN IF NOT EXISTS contractor_name text,
  ADD COLUMN IF NOT EXISTS execution_contract text,
  ADD COLUMN IF NOT EXISTS supervision_contract text,
  ADD COLUMN IF NOT EXISTS subgerente_name text,
  ADD COLUMN IF NOT EXISTS resident_name text,
  ADD COLUMN IF NOT EXISTS supervisor_name text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS province text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS site_handover_date date,
  ADD COLUMN IF NOT EXISTS execution_term_days integer,
  ADD COLUMN IF NOT EXISTS planned_completion_date date,
  ADD COLUMN IF NOT EXISTS new_completion_date date,
  ADD COLUMN IF NOT EXISTS expediente_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS direct_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overhead_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS utility_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igv_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additionals_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deductives_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extensions_days integer DEFAULT 0;

-- =========================================
-- 2. Períodos de valorización (expediente mensual)
-- =========================================
CREATE TABLE IF NOT EXISTS public.valuation_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_number integer NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- draft | calculated | issued
  generalidades text,
  metas text,
  ocurrencias text,
  conclusiones text,
  resumen_ejecutivo text,
  carta_presentacion text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, period_number)
);

ALTER TABLE public.valuation_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY valuation_periods_view_policy ON public.valuation_periods
  FOR SELECT TO authenticated
  USING (can_view_project(project_id, auth.uid()));

CREATE POLICY valuation_periods_insert_policy ON public.valuation_periods
  FOR INSERT TO authenticated
  WITH CHECK (can_edit_project_data(project_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY valuation_periods_update_policy ON public.valuation_periods
  FOR UPDATE TO authenticated
  USING (can_edit_project_data(project_id, auth.uid()) OR can_review_project_data(project_id, auth.uid()))
  WITH CHECK (can_edit_project_data(project_id, auth.uid()) OR can_review_project_data(project_id, auth.uid()));

CREATE POLICY valuation_periods_delete_policy ON public.valuation_periods
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR created_by = auth.uid());

CREATE TRIGGER trg_valuation_periods_updated_at
  BEFORE UPDATE ON public.valuation_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- 3. Líneas detalladas de metrado
-- =========================================
CREATE TABLE IF NOT EXISTS public.metrado_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES public.valuation_periods(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
  group_label text,                -- p. ej. "Calle Lima - Cuadra 2"
  location_ref text,               -- referencia adicional libre
  description text,                -- texto libre de la línea
  num_elements numeric DEFAULT 1,
  length numeric,
  width numeric,
  height numeric,
  formula text,                    -- fórmula libre opcional ("L*A*H*N" por defecto)
  partial numeric NOT NULL DEFAULT 0,  -- parcial calculado
  observation text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metrado_lines_period ON public.metrado_lines(period_id);
CREATE INDEX IF NOT EXISTS idx_metrado_lines_item ON public.metrado_lines(item_id);

ALTER TABLE public.metrado_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY metrado_lines_view_policy ON public.metrado_lines
  FOR SELECT TO authenticated
  USING (can_view_project(project_id, auth.uid()));

CREATE POLICY metrado_lines_insert_policy ON public.metrado_lines
  FOR INSERT TO authenticated
  WITH CHECK (can_edit_project_data(project_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY metrado_lines_update_policy ON public.metrado_lines
  FOR UPDATE TO authenticated
  USING (can_edit_project_data(project_id, auth.uid()))
  WITH CHECK (can_edit_project_data(project_id, auth.uid()));

CREATE POLICY metrado_lines_delete_policy ON public.metrado_lines
  FOR DELETE TO authenticated
  USING (can_edit_project_data(project_id, auth.uid()));

CREATE TRIGGER trg_metrado_lines_updated_at
  BEFORE UPDATE ON public.metrado_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- 4. Deducciones por valorización
-- =========================================
DO $$ BEGIN
  CREATE TYPE public.deduction_type AS ENUM (
    'adelanto_directo',
    'adelanto_materiales',
    'fondo_garantia',
    'reintegro',
    'multa',
    'penalidad',
    'otra'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.valuation_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES public.valuation_periods(id) ON DELETE CASCADE,
  deduction_type public.deduction_type NOT NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  percentage numeric,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deductions_period ON public.valuation_deductions(period_id);

ALTER TABLE public.valuation_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY deductions_view_policy ON public.valuation_deductions
  FOR SELECT TO authenticated
  USING (can_view_project(project_id, auth.uid()));

CREATE POLICY deductions_insert_policy ON public.valuation_deductions
  FOR INSERT TO authenticated
  WITH CHECK (can_edit_project_data(project_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY deductions_update_policy ON public.valuation_deductions
  FOR UPDATE TO authenticated
  USING (can_edit_project_data(project_id, auth.uid()))
  WITH CHECK (can_edit_project_data(project_id, auth.uid()));

CREATE POLICY deductions_delete_policy ON public.valuation_deductions
  FOR DELETE TO authenticated
  USING (can_edit_project_data(project_id, auth.uid()));

CREATE TRIGGER trg_deductions_updated_at
  BEFORE UPDATE ON public.valuation_deductions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- 5. Expedientes mensuales generados (PDF)
-- =========================================
CREATE TABLE IF NOT EXISTS public.expediente_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES public.valuation_periods(id) ON DELETE CASCADE,
  file_path text,
  file_name text,
  total_valued numeric DEFAULT 0,
  total_deductions numeric DEFAULT 0,
  net_amount numeric DEFAULT 0,
  generated_by uuid NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expediente_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY expediente_view_policy ON public.expediente_documents
  FOR SELECT TO authenticated
  USING (can_view_project(project_id, auth.uid()));

CREATE POLICY expediente_insert_policy ON public.expediente_documents
  FOR INSERT TO authenticated
  WITH CHECK (can_edit_project_data(project_id, auth.uid()) AND generated_by = auth.uid());

CREATE POLICY expediente_delete_policy ON public.expediente_documents
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR generated_by = auth.uid());

-- =========================================
-- 6. Bucket de almacenamiento para expedientes generados
-- =========================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('expedientes', 'expedientes', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "expedientes_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'expedientes');

CREATE POLICY "expedientes_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expedientes');

CREATE POLICY "expedientes_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'expedientes');