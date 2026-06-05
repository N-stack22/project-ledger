-- =========================================================
-- 1. SECURITY DEFINER functions: lock down EXECUTE grants
-- =========================================================

-- Trigger-only functions: revoke EXECUTE from everyone (triggers run as owner)
DO $$
DECLARE
  fn text;
  trigger_fns text[] := ARRAY[
    'handle_new_user_profile()',
    'handle_new_user_role_bootstrap()',
    'log_audit_event()',
    'update_updated_at_column()',
    'prevent_contract_type_change_after_start()',
    'validate_liquidation_creation()',
    'validate_valuation_creation()'
  ];
BEGIN
  FOREACH fn IN ARRAY trigger_fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END$$;

-- RLS helper functions: revoke from anon/PUBLIC, keep authenticated
DO $$
DECLARE
  fn text;
  helper_fns text[] := ARRAY[
    'has_role(uuid, app_role)',
    'has_any_role(uuid, app_role[])',
    'has_global_role(uuid, global_role)',
    'has_project_role(uuid, uuid, project_role)',
    'has_any_project_role(uuid, uuid, project_role[])',
    'is_global_admin(uuid)',
    'is_project_member(uuid, uuid)',
    'can_view_project(uuid, uuid)',
    'can_edit_project_data(uuid, uuid)',
    'can_review_project_data(uuid, uuid)',
    'project_is_empty(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY helper_fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END$$;

-- =========================================================
-- 2. audit_logs: allow actor to see their own actions
-- =========================================================
DROP POLICY IF EXISTS audit_logs_view_policy ON public.audit_logs;
CREATE POLICY audit_logs_view_policy ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (project_id IS NOT NULL AND public.can_view_project(project_id, auth.uid()))
    OR (actor_user_id = auth.uid())
  );

-- =========================================================
-- 3. Storage buckets: scope by project membership
-- =========================================================
-- Path convention used by the app: "<project_id>/<...rest>"

-- Drop any existing policies on storage.objects for the three buckets
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        policyname ILIKE '%budget-imports%'
        OR policyname ILIKE '%project-documents%'
        OR policyname ILIKE '%expedientes%'
        OR policyname ILIKE 'budget_imports_%'
        OR policyname ILIKE 'project_documents_%'
        OR policyname ILIKE 'expedientes_%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END$$;

-- expedientes bucket
CREATE POLICY "expedientes_select_member" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'expedientes'
    AND public.can_view_project(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "expedientes_insert_editor" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expedientes'
    AND public.can_edit_project_data(((storage.foldername(name))[1])::uuid, auth.uid())
    AND owner = auth.uid()
  );

CREATE POLICY "expedientes_update_editor" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'expedientes'
    AND public.can_edit_project_data(((storage.foldername(name))[1])::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'expedientes'
    AND public.can_edit_project_data(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "expedientes_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'expedientes'
    AND (
      public.is_global_admin(auth.uid())
      OR public.has_project_role(((storage.foldername(name))[1])::uuid, auth.uid(), 'admin_proyecto'::public.project_role)
    )
  );

-- budget-imports bucket
CREATE POLICY "budget_imports_select_member" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'budget-imports'
    AND public.can_view_project(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "budget_imports_insert_editor" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'budget-imports'
    AND public.can_edit_project_data(((storage.foldername(name))[1])::uuid, auth.uid())
    AND owner = auth.uid()
  );

CREATE POLICY "budget_imports_update_editor" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'budget-imports'
    AND public.can_edit_project_data(((storage.foldername(name))[1])::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'budget-imports'
    AND public.can_edit_project_data(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "budget_imports_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'budget-imports'
    AND (
      public.is_global_admin(auth.uid())
      OR public.has_project_role(((storage.foldername(name))[1])::uuid, auth.uid(), 'admin_proyecto'::public.project_role)
    )
  );

-- project-documents bucket
CREATE POLICY "project_documents_select_member" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND public.can_view_project(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "project_documents_insert_editor" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-documents'
    AND public.can_edit_project_data(((storage.foldername(name))[1])::uuid, auth.uid())
    AND owner = auth.uid()
  );

CREATE POLICY "project_documents_update_editor" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND public.can_edit_project_data(((storage.foldername(name))[1])::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'project-documents'
    AND public.can_edit_project_data(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "project_documents_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND (
      public.is_global_admin(auth.uid())
      OR public.has_project_role(((storage.foldername(name))[1])::uuid, auth.uid(), 'admin_proyecto'::public.project_role)
    )
  );

-- =========================================================
-- 4. user_roles / user_global_roles: block self-escalation
-- =========================================================
-- Restrictive policy: even if a permissive INSERT exists, the row must NOT be a self-assignment
-- unless the actor already has the admin/super_admin role.

CREATE POLICY user_roles_no_self_escalation
  ON public.user_roles
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY user_global_roles_no_self_escalation
  ON public.user_global_roles
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_global_role(auth.uid(), 'super_admin'::public.global_role)
  );
