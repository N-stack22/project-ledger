CREATE OR REPLACE FUNCTION public.handle_new_user_role_bootstrap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles LIMIT 1) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_bootstrap_role ON auth.users;
CREATE TRIGGER on_auth_user_created_bootstrap_role
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role_bootstrap();

DROP POLICY IF EXISTS "budget_imports_manage_policy" ON public.budget_imports;
CREATE POLICY "budget_imports_insert_policy"
ON public.budget_imports
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_edit_project_data(project_id, auth.uid())
  AND uploaded_by = auth.uid()
);

CREATE POLICY "budget_imports_update_policy"
ON public.budget_imports
FOR UPDATE
TO authenticated
USING (public.can_edit_project_data(project_id, auth.uid()))
WITH CHECK (public.can_edit_project_data(project_id, auth.uid()));

CREATE POLICY "budget_imports_delete_policy"
ON public.budget_imports
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.can_edit_project_data(project_id, auth.uid()));

DROP POLICY IF EXISTS "liquidations_manage_policy" ON public.liquidations;
CREATE POLICY "liquidations_insert_policy"
ON public.liquidations
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_review_project_data(project_id, auth.uid())
  AND created_by = auth.uid()
);

CREATE POLICY "liquidations_update_policy"
ON public.liquidations
FOR UPDATE
TO authenticated
USING (public.can_review_project_data(project_id, auth.uid()))
WITH CHECK (public.can_review_project_data(project_id, auth.uid()));

CREATE POLICY "liquidations_delete_policy"
ON public.liquidations
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "project_members_manage_policy" ON public.project_members;
CREATE POLICY "project_members_insert_policy"
ON public.project_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'resident')
    AND public.is_project_member(project_id, auth.uid())
  )
);

CREATE POLICY "project_members_update_policy"
ON public.project_members
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'resident')
    AND public.is_project_member(project_id, auth.uid())
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'resident')
    AND public.is_project_member(project_id, auth.uid())
  )
);

CREATE POLICY "project_members_delete_policy"
ON public.project_members
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'resident')
    AND public.is_project_member(project_id, auth.uid())
  )
);