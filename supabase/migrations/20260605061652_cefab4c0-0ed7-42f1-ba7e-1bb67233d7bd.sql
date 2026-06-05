-- ============================================================
-- FASE 1: Roles globales + Roles por proyecto (orden corregido)
-- ============================================================

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE public.global_role AS ENUM ('super_admin', 'admin_empresa', 'usuario_registrado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.project_role AS ENUM (
    'admin_proyecto',
    'residente_obra',
    'supervisor_inspector',
    'entidad_publica',
    'representante_legal'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. project_members: agregar columna project_role y migrar ANTES de crear helpers
ALTER TABLE public.project_members
  ADD COLUMN IF NOT EXISTS project_role public.project_role;

UPDATE public.project_members
SET project_role = CASE role::text
  WHEN 'admin' THEN 'admin_proyecto'::public.project_role
  WHEN 'resident' THEN 'residente_obra'::public.project_role
  WHEN 'supervisor' THEN 'supervisor_inspector'::public.project_role
  WHEN 'legal_representative' THEN 'representante_legal'::public.project_role
  WHEN 'assistant' THEN 'residente_obra'::public.project_role
  ELSE 'residente_obra'::public.project_role
END
WHERE project_role IS NULL;

-- Asegurar que el creador del proyecto sea miembro como admin_proyecto
INSERT INTO public.project_members (project_id, user_id, role, project_role)
SELECT p.id, p.created_by, 'admin'::public.app_role, 'admin_proyecto'::public.project_role
FROM public.projects p
WHERE p.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = p.id AND pm.user_id = p.created_by
  );

ALTER TABLE public.project_members ALTER COLUMN project_role SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_members_user_project
  ON public.project_members (user_id, project_id);

-- 3. Tabla user_global_roles
CREATE TABLE IF NOT EXISTS public.user_global_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.global_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_global_roles TO authenticated;
GRANT ALL ON public.user_global_roles TO service_role;
ALTER TABLE public.user_global_roles ENABLE ROW LEVEL SECURITY;

-- 4. Migrar datos de user_roles → user_global_roles
INSERT INTO public.user_global_roles (user_id, role)
SELECT DISTINCT u.id, 'usuario_registrado'::public.global_role
FROM auth.users u
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_global_roles (user_id, role)
SELECT DISTINCT ur.user_id, 'super_admin'::public.global_role
FROM public.user_roles ur
WHERE ur.role = 'admin'
ON CONFLICT (user_id, role) DO NOTHING;

-- 5. Helpers de rol (ya pueden referenciar la columna)
CREATE OR REPLACE FUNCTION public.has_global_role(_user_id uuid, _role public.global_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_global_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_global_roles
    WHERE user_id = _user_id AND role IN ('super_admin', 'admin_empresa')
  );
$$;

CREATE OR REPLACE FUNCTION public.has_project_role(_project_id uuid, _user_id uuid, _role public.project_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = _project_id AND user_id = _user_id AND project_role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_project_role(_project_id uuid, _user_id uuid, _roles public.project_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = _project_id AND user_id = _user_id AND project_role = ANY(_roles)
  );
$$;

-- 6. Reescribir helpers existentes para usar nuevo modelo
CREATE OR REPLACE FUNCTION public.can_view_project(_project_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (public.is_global_admin(_user_id) OR public.is_project_member(_project_id, _user_id));
$$;

CREATE OR REPLACE FUNCTION public.can_edit_project_data(_project_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    public.is_global_admin(_user_id)
    OR public.has_any_project_role(_project_id, _user_id,
        ARRAY['admin_proyecto','residente_obra']::public.project_role[])
  );
$$;

CREATE OR REPLACE FUNCTION public.can_review_project_data(_project_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    public.is_global_admin(_user_id)
    OR public.has_any_project_role(_project_id, _user_id,
        ARRAY['admin_proyecto','residente_obra','supervisor_inspector']::public.project_role[])
  );
$$;

-- 7. Políticas user_global_roles
DROP POLICY IF EXISTS user_global_roles_self_view ON public.user_global_roles;
CREATE POLICY user_global_roles_self_view ON public.user_global_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_global_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS user_global_roles_admin_manage ON public.user_global_roles;
CREATE POLICY user_global_roles_admin_manage ON public.user_global_roles
  FOR ALL TO authenticated
  USING (public.has_global_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_global_role(auth.uid(), 'super_admin'));

-- 8. projects: solo super_admin/admin_empresa crean; admin_proyecto edita
DROP POLICY IF EXISTS projects_create_policy ON public.projects;
CREATE POLICY projects_create_policy ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK ((created_by = auth.uid()) AND public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS projects_update_policy ON public.projects;
CREATE POLICY projects_update_policy ON public.projects
  FOR UPDATE TO authenticated
  USING (public.is_global_admin(auth.uid()) OR public.has_project_role(id, auth.uid(), 'admin_proyecto'))
  WITH CHECK (public.is_global_admin(auth.uid()) OR public.has_project_role(id, auth.uid(), 'admin_proyecto'));

DROP POLICY IF EXISTS projects_view_policy ON public.projects;
CREATE POLICY projects_view_policy ON public.projects
  FOR SELECT TO authenticated
  USING (public.is_global_admin(auth.uid()) OR public.is_project_member(id, auth.uid()));

DROP POLICY IF EXISTS projects_delete_policy ON public.projects;
CREATE POLICY projects_delete_policy ON public.projects
  FOR DELETE TO authenticated
  USING (public.is_global_admin(auth.uid()) AND public.project_is_empty(id));

-- 9. project_members
DROP POLICY IF EXISTS project_members_insert_policy ON public.project_members;
CREATE POLICY project_members_insert_policy ON public.project_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_global_admin(auth.uid())
    OR public.has_project_role(project_id, auth.uid(), 'admin_proyecto')
    OR (
      user_id = auth.uid()
      AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS project_members_update_policy ON public.project_members;
CREATE POLICY project_members_update_policy ON public.project_members
  FOR UPDATE TO authenticated
  USING (public.is_global_admin(auth.uid()) OR public.has_project_role(project_id, auth.uid(), 'admin_proyecto'))
  WITH CHECK (public.is_global_admin(auth.uid()) OR public.has_project_role(project_id, auth.uid(), 'admin_proyecto'));

DROP POLICY IF EXISTS project_members_delete_policy ON public.project_members;
CREATE POLICY project_members_delete_policy ON public.project_members
  FOR DELETE TO authenticated
  USING (public.is_global_admin(auth.uid()) OR public.has_project_role(project_id, auth.uid(), 'admin_proyecto'));

DROP POLICY IF EXISTS project_members_view_policy ON public.project_members;
CREATE POLICY project_members_view_policy ON public.project_members
  FOR SELECT TO authenticated
  USING (public.is_global_admin(auth.uid()) OR public.is_project_member(project_id, auth.uid()));

-- 10. Trigger bootstrap: nuevo usuario solo es 'usuario_registrado'
CREATE OR REPLACE FUNCTION public.handle_new_user_role_bootstrap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_global_roles (user_id, role)
  VALUES (NEW.id, 'usuario_registrado')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 11. Vista de conveniencia
CREATE OR REPLACE VIEW public.v_my_projects AS
SELECT p.id, p.code, p.name, p.status, pm.project_role, p.created_at
FROM public.projects p
JOIN public.project_members pm ON pm.project_id = p.id
WHERE pm.user_id = auth.uid();

GRANT SELECT ON public.v_my_projects TO authenticated;