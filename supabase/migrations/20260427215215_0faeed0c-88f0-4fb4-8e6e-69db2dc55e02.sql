-- 1) Add 'cancelled' to project_status enum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'project_status' AND e.enumlabel = 'cancelled'
  ) THEN
    ALTER TYPE public.project_status ADD VALUE 'cancelled';
  END IF;
END$$;

-- 2) Function: check if a project is empty (no related child data)
CREATE OR REPLACE FUNCTION public.project_is_empty(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM public.budget_imports      WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.budget_items    WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.metrado_entries WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.metrado_lines   WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.memoria_valorizada WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.valuations      WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.valuation_periods WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.valuation_deductions WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.liquidations    WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.expediente_documents WHERE project_id = _project_id)
    AND NOT EXISTS (SELECT 1 FROM public.workflow_comments WHERE project_id = _project_id)
$$;

-- 3) DELETE policy on projects: only admin or creator AND project must be empty
CREATE POLICY projects_delete_policy
ON public.projects
FOR DELETE
TO authenticated
USING (
  (public.has_role(auth.uid(), 'admin') OR created_by = auth.uid())
  AND public.project_is_empty(id)
);