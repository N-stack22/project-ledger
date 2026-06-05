DROP VIEW IF EXISTS public.v_my_projects;

CREATE VIEW public.v_my_projects
WITH (security_invoker = true) AS
SELECT p.id, p.code, p.name, p.status, pm.project_role, p.created_at
FROM public.projects p
JOIN public.project_members pm ON pm.project_id = p.id
WHERE pm.user_id = auth.uid();

GRANT SELECT ON public.v_my_projects TO authenticated;