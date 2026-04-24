-- Relax projects INSERT policy: allow any authenticated user to create a project
-- but require created_by = auth.uid(). Role-based restriction can be re-added later.
DROP POLICY IF EXISTS projects_create_policy ON public.projects;

CREATE POLICY projects_create_policy
ON public.projects
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

-- Ensure creator can view & update their own projects even without explicit role/membership
DROP POLICY IF EXISTS projects_view_policy ON public.projects;
CREATE POLICY projects_view_policy
ON public.projects
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  OR can_view_project(id, auth.uid())
);

DROP POLICY IF EXISTS projects_update_policy ON public.projects;
CREATE POLICY projects_update_policy
ON public.projects
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  OR has_role(auth.uid(), 'admin')
  OR (has_role(auth.uid(), 'resident') AND is_project_member(id, auth.uid()))
)
WITH CHECK (
  created_by = auth.uid()
  OR has_role(auth.uid(), 'admin')
  OR (has_role(auth.uid(), 'resident') AND is_project_member(id, auth.uid()))
);

-- Allow creators to register themselves as project members so they immediately gain access
DROP POLICY IF EXISTS project_members_insert_policy ON public.project_members;
CREATE POLICY project_members_insert_policy
ON public.project_members
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin')
  OR (has_role(auth.uid(), 'resident') AND is_project_member(project_id, auth.uid()))
  OR (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
  )
);