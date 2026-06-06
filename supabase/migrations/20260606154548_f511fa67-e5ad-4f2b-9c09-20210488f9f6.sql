
DROP POLICY IF EXISTS expediente_delete_policy ON public.expediente_documents;
CREATE POLICY expediente_delete_policy ON public.expediente_documents
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (generated_by = auth.uid() AND can_edit_project_data(project_id, auth.uid()))
  );

DROP POLICY IF EXISTS valuation_periods_delete_policy ON public.valuation_periods;
CREATE POLICY valuation_periods_delete_policy ON public.valuation_periods
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (created_by = auth.uid() AND can_edit_project_data(project_id, auth.uid()))
  );
