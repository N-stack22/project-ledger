
-- 1) project_is_empty: dejar de mirar metrado_entries
CREATE OR REPLACE FUNCTION public.project_is_empty(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM public.budget_imports      WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.budget_items    WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.metrado_lines   WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.memoria_valorizada WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.valuations      WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.valuation_periods WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.valuation_deductions WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.liquidations    WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.expediente_documents WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.workflow_comments WHERE project_id = _project_id)
$$;

-- 2) validate_valuation_creation: usar metrado_lines + valuation_periods
CREATE OR REPLACE FUNCTION public.validate_valuation_creation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  memoria_status public.document_status;
  project_contract_type public.contract_type;
  line_count INTEGER;
BEGIN
  SELECT status INTO memoria_status
  FROM public.memoria_valorizada
  WHERE id = NEW.memoria_id
    AND project_id = NEW.project_id
    AND period_month = NEW.period_month;

  IF memoria_status IS NULL THEN
    RAISE EXCEPTION 'memoria_valorizada_required_for_valuation';
  END IF;

  IF memoria_status <> 'approved' THEN
    RAISE EXCEPTION 'memoria_valorizada_must_be_approved_before_valuation';
  END IF;

  SELECT contract_type INTO project_contract_type
  FROM public.projects
  WHERE id = NEW.project_id;

  IF project_contract_type IS NULL THEN
    RAISE EXCEPTION 'project_not_found_for_valuation';
  END IF;

  NEW.contract_type_snapshot := project_contract_type;

  SELECT COUNT(*) INTO line_count
  FROM public.metrado_lines ml
  JOIN public.valuation_periods vp ON vp.id = ml.period_id
  WHERE ml.project_id = NEW.project_id
    AND date_trunc('month', vp.date_from::timestamp)::date = NEW.period_month;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'metrados_required_for_valuation';
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Eliminar la tabla legacy (con sus triggers, índices y policies)
DROP TABLE IF EXISTS public.metrado_entries CASCADE;
