-- ============================================================
-- Source: 20260423173227_fdddc406-6b57-4300-bd31-ee4526485e65.sql
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.app_role AS ENUM ('admin', 'assistant', 'resident', 'supervisor', 'legal_representative');
CREATE TYPE public.contract_type AS ENUM ('precios_unitarios', 'suma_alzada');
CREATE TYPE public.project_status AS ENUM ('draft', 'active', 'closing', 'closed', 'archived');
CREATE TYPE public.import_status AS ENUM ('pending', 'processing', 'validated', 'imported', 'failed');
CREATE TYPE public.entry_status AS ENUM ('draft', 'submitted', 'validated', 'rejected');
CREATE TYPE public.document_status AS ENUM ('draft', 'in_review', 'approved', 'rejected');
CREATE TYPE public.valuation_status AS ENUM ('pending', 'reviewed', 'approved', 'rejected');
CREATE TYPE public.liquidation_status AS ENUM ('draft', 'generated', 'approved');
CREATE TYPE public.workflow_entity AS ENUM ('memoria_valorizada', 'valuation', 'liquidation');
CREATE TYPE public.workflow_action AS ENUM ('created', 'submitted', 'reviewed', 'approved', 'rejected', 'commented', 'exported', 'closed');

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  job_title TEXT,
  phone TEXT,
  signature_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = ANY(_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_create_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  client_name TEXT,
  location TEXT,
  description TEXT,
  contract_type public.contract_type NOT NULL,
  contract_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'PEN',
  start_date DATE,
  planned_end_date DATE,
  actual_end_date DATE,
  started_at TIMESTAMPTZ,
  status public.project_status NOT NULL DEFAULT 'draft',
  progress_percent NUMERIC(7,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT projects_progress_percent_check CHECK (progress_percent >= 0 AND progress_percent <= 100),
  CONSTRAINT projects_contract_amount_check CHECK (contract_amount >= 0)
);

CREATE TABLE public.project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id, role)
);

CREATE TABLE public.budget_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status public.import_status NOT NULL DEFAULT 'pending',
  column_mapping JSONB,
  validation_summary JSONB,
  error_details JSONB,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.budget_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  budget_import_id UUID REFERENCES public.budget_imports(id) ON DELETE SET NULL,
  item_code TEXT,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  base_quantity NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit_price NUMERIC(14,4) NOT NULL DEFAULT 0,
  partial_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  category TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT budget_items_base_quantity_check CHECK (base_quantity >= 0),
  CONSTRAINT budget_items_unit_price_check CHECK (unit_price >= 0),
  CONSTRAINT budget_items_partial_amount_check CHECK (partial_amount >= 0),
  UNIQUE (project_id, item_code, description)
);

CREATE TABLE public.metrado_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  period_month DATE NOT NULL,
  quantity NUMERIC(14,4) NOT NULL,
  notes TEXT,
  status public.entry_status NOT NULL DEFAULT 'draft',
  validated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT metrado_entries_quantity_check CHECK (quantity > 0),
  CONSTRAINT metrado_entries_period_first_day CHECK (date_trunc('month', period_month::timestamp) = period_month::timestamp)
);

CREATE TABLE public.memoria_valorizada (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  title TEXT NOT NULL,
  executive_summary TEXT,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.document_status NOT NULL DEFAULT 'draft',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL DEFAULT 1,
  document_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memoria_valorizada_period_first_day CHECK (date_trunc('month', period_month::timestamp) = period_month::timestamp),
  UNIQUE (project_id, period_month)
);

CREATE TABLE public.valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  memoria_id UUID NOT NULL UNIQUE REFERENCES public.memoria_valorizada(id) ON DELETE RESTRICT,
  contract_type_snapshot public.contract_type NOT NULL,
  total_quantity NUMERIC(14,4) NOT NULL DEFAULT 0,
  progress_percent NUMERIC(7,2) NOT NULL DEFAULT 0,
  gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deductions_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status public.valuation_status NOT NULL DEFAULT 'pending',
  resident_reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resident_reviewed_at TIMESTAMPTZ,
  supervisor_reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  supervisor_reviewed_at TIMESTAMPTZ,
  supervisor_comment TEXT,
  generated_document_path TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valuations_period_first_day CHECK (date_trunc('month', period_month::timestamp) = period_month::timestamp),
  CONSTRAINT valuations_progress_percent_check CHECK (progress_percent >= 0 AND progress_percent <= 100),
  UNIQUE (project_id, period_month)
);

CREATE TABLE public.valuation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  valuation_id UUID NOT NULL REFERENCES public.valuations(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.budget_items(id) ON DELETE RESTRICT,
  quantity_period NUMERIC(14,4) NOT NULL DEFAULT 0,
  quantity_accumulated NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit_price_applied NUMERIC(14,4) NOT NULL DEFAULT 0,
  percentage_applied NUMERIC(7,2) NOT NULL DEFAULT 0,
  line_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valuation_lines_quantity_period_check CHECK (quantity_period >= 0),
  CONSTRAINT valuation_lines_quantity_accumulated_check CHECK (quantity_accumulated >= 0),
  CONSTRAINT valuation_lines_unit_price_check CHECK (unit_price_applied >= 0),
  CONSTRAINT valuation_lines_percentage_check CHECK (percentage_applied >= 0 AND percentage_applied <= 100),
  CONSTRAINT valuation_lines_line_amount_check CHECK (line_amount >= 0),
  UNIQUE (valuation_id, item_id)
);

CREATE TABLE public.workflow_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entity_type public.workflow_entity NOT NULL,
  entity_id UUID NOT NULL,
  action public.workflow_action NOT NULL DEFAULT 'commented',
  comment_text TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.liquidations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  summary_text TEXT,
  total_valued_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  final_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status public.liquidation_status NOT NULL DEFAULT 'draft',
  generated_document_path TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT liquidation_amounts_non_negative CHECK (total_valued_amount >= 0 AND total_deductions_amount >= 0 AND final_amount >= 0)
);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  previous_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_projects_status ON public.projects(status);
CREATE INDEX idx_project_members_project_id ON public.project_members(project_id);
CREATE INDEX idx_project_members_user_id ON public.project_members(user_id);
CREATE INDEX idx_budget_imports_project_id ON public.budget_imports(project_id);
CREATE INDEX idx_budget_items_project_id ON public.budget_items(project_id);
CREATE INDEX idx_metrado_entries_project_item_period ON public.metrado_entries(project_id, item_id, period_month);
CREATE INDEX idx_memoria_valorizada_project_period ON public.memoria_valorizada(project_id, period_month);
CREATE INDEX idx_valuations_project_period ON public.valuations(project_id, period_month);
CREATE INDEX idx_valuation_lines_valuation_id ON public.valuation_lines(valuation_id);
CREATE INDEX idx_workflow_comments_entity ON public.workflow_comments(entity_type, entity_id);
CREATE INDEX idx_audit_logs_project_id ON public.audit_logs(project_id);
CREATE INDEX idx_audit_logs_actor_user_id ON public.audit_logs(actor_user_id);

CREATE OR REPLACE FUNCTION public.is_project_member(_project_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = _project_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_project(_project_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    public.has_any_role(_user_id, ARRAY['admin']::public.app_role[])
    OR public.is_project_member(_project_id, _user_id)
    OR public.has_role(_user_id, 'legal_representative')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_project_data(_project_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    public.has_any_role(_user_id, ARRAY['admin','assistant','resident']::public.app_role[])
    AND (
      public.has_role(_user_id, 'admin')
      OR public.is_project_member(_project_id, _user_id)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_review_project_data(_project_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    public.has_any_role(_user_id, ARRAY['admin','resident','supervisor']::public.app_role[])
    AND (
      public.has_role(_user_id, 'admin')
      OR public.is_project_member(_project_id, _user_id)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.prevent_contract_type_change_after_start()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.contract_type IS DISTINCT FROM NEW.contract_type
     AND (OLD.started_at IS NOT NULL OR OLD.status <> 'draft') THEN
    RAISE EXCEPTION 'contract_type_cannot_change_after_project_start';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_contract_type_change
BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.prevent_contract_type_change_after_start();

CREATE OR REPLACE FUNCTION public.validate_valuation_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  memoria_status public.document_status;
  project_contract_type public.contract_type;
  period_entries INTEGER;
BEGIN
  SELECT status INTO memoria_status
  FROM public.memoria_valorizada
  WHERE id = NEW.memoria_id AND project_id = NEW.project_id AND period_month = NEW.period_month;

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

  SELECT COUNT(*) INTO period_entries
  FROM public.metrado_entries
  WHERE project_id = NEW.project_id
    AND period_month = NEW.period_month
    AND status = 'validated';

  IF period_entries = 0 THEN
    RAISE EXCEPTION 'validated_metrados_required_for_valuation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_valuation_creation_trigger
BEFORE INSERT OR UPDATE ON public.valuations
FOR EACH ROW EXECUTE FUNCTION public.validate_valuation_creation();

CREATE OR REPLACE FUNCTION public.validate_liquidation_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  approved_valuations INTEGER;
  current_project_status public.project_status;
BEGIN
  SELECT status INTO current_project_status
  FROM public.projects
  WHERE id = NEW.project_id;

  IF current_project_status NOT IN ('closing', 'closed') THEN
    RAISE EXCEPTION 'project_must_be_in_closing_or_closed_status';
  END IF;

  SELECT COUNT(*) INTO approved_valuations
  FROM public.valuations
  WHERE project_id = NEW.project_id AND status = 'approved';

  IF approved_valuations = 0 THEN
    RAISE EXCEPTION 'approved_valuations_required_for_liquidation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_liquidation_creation_trigger
BEFORE INSERT OR UPDATE ON public.liquidations
FOR EACH ROW EXECUTE FUNCTION public.validate_liquidation_creation();

CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_actor UUID;
  target_project UUID;
BEGIN
  current_actor := auth.uid();
  target_project := COALESCE(NEW.project_id, OLD.project_id);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (project_id, actor_user_id, entity_type, entity_id, action, new_data)
    VALUES (target_project, current_actor, TG_TABLE_NAME, NEW.id, TG_OP, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (project_id, actor_user_id, entity_type, entity_id, action, previous_data, new_data)
    VALUES (target_project, current_actor, TG_TABLE_NAME, NEW.id, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSE
    INSERT INTO public.audit_logs (project_id, actor_user_id, entity_type, entity_id, action, previous_data)
    VALUES (target_project, current_actor, TG_TABLE_NAME, OLD.id, TG_OP, to_jsonb(OLD));
    RETURN OLD;
  END IF;
END;
$$;

CREATE TRIGGER audit_projects
AFTER INSERT OR UPDATE OR DELETE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
CREATE TRIGGER audit_budget_imports
AFTER INSERT OR UPDATE OR DELETE ON public.budget_imports
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
CREATE TRIGGER audit_budget_items
AFTER INSERT OR UPDATE OR DELETE ON public.budget_items
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
CREATE TRIGGER audit_metrado_entries
AFTER INSERT OR UPDATE OR DELETE ON public.metrado_entries
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
CREATE TRIGGER audit_memoria_valorizada
AFTER INSERT OR UPDATE OR DELETE ON public.memoria_valorizada
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
CREATE TRIGGER audit_valuations
AFTER INSERT OR UPDATE OR DELETE ON public.valuations
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
CREATE TRIGGER audit_liquidations
AFTER INSERT OR UPDATE OR DELETE ON public.liquidations
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_budget_imports_updated_at
BEFORE UPDATE ON public.budget_imports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_budget_items_updated_at
BEFORE UPDATE ON public.budget_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_metrado_entries_updated_at
BEFORE UPDATE ON public.metrado_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_memoria_valorizada_updated_at
BEFORE UPDATE ON public.memoria_valorizada
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_valuations_updated_at
BEFORE UPDATE ON public.valuations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_valuation_lines_updated_at
BEFORE UPDATE ON public.valuation_lines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_liquidations_updated_at
BEFORE UPDATE ON public.liquidations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrado_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memoria_valorizada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.valuation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liquidations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_self_or_admin_view"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "profiles_self_or_admin_insert"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "profiles_self_or_admin_update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "user_roles_admin_view"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR auth.uid() = user_id
);

CREATE POLICY "user_roles_admin_manage"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "projects_view_policy"
ON public.projects
FOR SELECT
TO authenticated
USING (public.can_view_project(id, auth.uid()));

CREATE POLICY "projects_create_policy"
ON public.projects
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','resident']::public.app_role[]));

CREATE POLICY "projects_update_policy"
ON public.projects
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'resident')
    AND public.is_project_member(id, auth.uid())
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'resident')
    AND public.is_project_member(id, auth.uid())
  )
);

CREATE POLICY "project_members_view_policy"
ON public.project_members
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.can_view_project(project_id, auth.uid())
);

CREATE POLICY "project_members_manage_policy"
ON public.project_members
FOR ALL
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','resident']::public.app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','resident']::public.app_role[]));

CREATE POLICY "budget_imports_view_policy"
ON public.budget_imports
FOR SELECT
TO authenticated
USING (public.can_view_project(project_id, auth.uid()));

CREATE POLICY "budget_imports_manage_policy"
ON public.budget_imports
FOR ALL
TO authenticated
USING (public.can_edit_project_data(project_id, auth.uid()))
WITH CHECK (
  public.can_edit_project_data(project_id, auth.uid())
  AND uploaded_by = auth.uid()
);

CREATE POLICY "budget_items_view_policy"
ON public.budget_items
FOR SELECT
TO authenticated
USING (public.can_view_project(project_id, auth.uid()));

CREATE POLICY "budget_items_manage_policy"
ON public.budget_items
FOR ALL
TO authenticated
USING (public.can_edit_project_data(project_id, auth.uid()))
WITH CHECK (public.can_edit_project_data(project_id, auth.uid()));

CREATE POLICY "metrado_entries_view_policy"
ON public.metrado_entries
FOR SELECT
TO authenticated
USING (public.can_view_project(project_id, auth.uid()));

CREATE POLICY "metrado_entries_manage_policy"
ON public.metrado_entries
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_edit_project_data(project_id, auth.uid())
  AND created_by = auth.uid()
);

CREATE POLICY "metrado_entries_update_policy"
ON public.metrado_entries
FOR UPDATE
TO authenticated
USING (
  public.can_edit_project_data(project_id, auth.uid())
  OR public.can_review_project_data(project_id, auth.uid())
)
WITH CHECK (
  public.can_edit_project_data(project_id, auth.uid())
  OR public.can_review_project_data(project_id, auth.uid())
);

CREATE POLICY "memoria_view_policy"
ON public.memoria_valorizada
FOR SELECT
TO authenticated
USING (public.can_view_project(project_id, auth.uid()));

CREATE POLICY "memoria_create_policy"
ON public.memoria_valorizada
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_edit_project_data(project_id, auth.uid())
  AND created_by = auth.uid()
);

CREATE POLICY "memoria_update_policy"
ON public.memoria_valorizada
FOR UPDATE
TO authenticated
USING (
  public.can_edit_project_data(project_id, auth.uid())
  OR public.can_review_project_data(project_id, auth.uid())
)
WITH CHECK (
  public.can_edit_project_data(project_id, auth.uid())
  OR public.can_review_project_data(project_id, auth.uid())
);

CREATE POLICY "valuations_view_policy"
ON public.valuations
FOR SELECT
TO authenticated
USING (public.can_view_project(project_id, auth.uid()));

CREATE POLICY "valuations_create_policy"
ON public.valuations
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_review_project_data(project_id, auth.uid())
  AND created_by = auth.uid()
);

CREATE POLICY "valuations_update_policy"
ON public.valuations
FOR UPDATE
TO authenticated
USING (public.can_review_project_data(project_id, auth.uid()))
WITH CHECK (public.can_review_project_data(project_id, auth.uid()));

CREATE POLICY "valuation_lines_view_policy"
ON public.valuation_lines
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.valuations v
    WHERE v.id = valuation_id
      AND public.can_view_project(v.project_id, auth.uid())
  )
);

CREATE POLICY "valuation_lines_manage_policy"
ON public.valuation_lines
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.valuations v
    WHERE v.id = valuation_id
      AND public.can_review_project_data(v.project_id, auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.valuations v
    WHERE v.id = valuation_id
      AND public.can_review_project_data(v.project_id, auth.uid())
  )
);

CREATE POLICY "workflow_comments_view_policy"
ON public.workflow_comments
FOR SELECT
TO authenticated
USING (public.can_view_project(project_id, auth.uid()));

CREATE POLICY "workflow_comments_manage_policy"
ON public.workflow_comments
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_review_project_data(project_id, auth.uid())
  AND created_by = auth.uid()
);

CREATE POLICY "liquidations_view_policy"
ON public.liquidations
FOR SELECT
TO authenticated
USING (public.can_view_project(project_id, auth.uid()));

CREATE POLICY "liquidations_manage_policy"
ON public.liquidations
FOR ALL
TO authenticated
USING (public.can_review_project_data(project_id, auth.uid()))
WITH CHECK (
  public.can_review_project_data(project_id, auth.uid())
  AND created_by = auth.uid()
);

CREATE POLICY "audit_logs_view_policy"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    project_id IS NOT NULL
    AND public.can_view_project(project_id, auth.uid())
  )
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('budget-imports', 'budget-imports', false), ('project-documents', 'project-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "budget_imports_bucket_view"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'budget-imports'
  AND public.has_any_role(auth.uid(), ARRAY['admin','assistant','resident','supervisor','legal_representative']::public.app_role[])
);

CREATE POLICY "budget_imports_bucket_write"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'budget-imports'
  AND public.has_any_role(auth.uid(), ARRAY['admin','assistant','resident']::public.app_role[])
);

CREATE POLICY "budget_imports_bucket_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'budget-imports'
  AND public.has_any_role(auth.uid(), ARRAY['admin','assistant','resident']::public.app_role[])
)
WITH CHECK (
  bucket_id = 'budget-imports'
  AND public.has_any_role(auth.uid(), ARRAY['admin','assistant','resident']::public.app_role[])
);

CREATE POLICY "project_documents_bucket_view"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'project-documents'
  AND public.has_any_role(auth.uid(), ARRAY['admin','assistant','resident','supervisor','legal_representative']::public.app_role[])
);

CREATE POLICY "project_documents_bucket_write"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'project-documents'
  AND public.has_any_role(auth.uid(), ARRAY['admin','assistant','resident','supervisor']::public.app_role[])
);

CREATE POLICY "project_documents_bucket_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'project-documents'
  AND public.has_any_role(auth.uid(), ARRAY['admin','assistant','resident','supervisor']::public.app_role[])
)
WITH CHECK (
  bucket_id = 'project-documents'
  AND public.has_any_role(auth.uid(), ARRAY['admin','assistant','resident','supervisor']::public.app_role[])
);

-- ============================================================
-- Source: 20260423174107_00b823d9-a0fb-4393-af56-a69bd75f09b9.sql
-- ============================================================
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

-- ============================================================
-- Source: 20260424175430_f9498032-6318-493b-9284-5ef78eb2b99e.sql
-- ============================================================
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

-- ============================================================
-- Source: 20260424175932_0c7a3b06-eb52-4820-a5b3-e749b586d3cc.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  current_actor UUID;
  target_project UUID;
  rec_new JSONB;
  rec_old JSONB;
BEGIN
  current_actor := auth.uid();

  IF TG_OP <> 'DELETE' THEN
    rec_new := to_jsonb(NEW);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    rec_old := to_jsonb(OLD);
  END IF;

  IF TG_TABLE_NAME = 'projects' THEN
    target_project := COALESCE((rec_new->>'id')::uuid, (rec_old->>'id')::uuid);
  ELSE
    target_project := COALESCE((rec_new->>'project_id')::uuid, (rec_old->>'project_id')::uuid);
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (project_id, actor_user_id, entity_type, entity_id, action, new_data)
    VALUES (target_project, current_actor, TG_TABLE_NAME, NEW.id, TG_OP, rec_new);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (project_id, actor_user_id, entity_type, entity_id, action, previous_data, new_data)
    VALUES (target_project, current_actor, TG_TABLE_NAME, NEW.id, TG_OP, rec_old, rec_new);
    RETURN NEW;
  ELSE
    INSERT INTO public.audit_logs (project_id, actor_user_id, entity_type, entity_id, action, previous_data)
    VALUES (target_project, current_actor, TG_TABLE_NAME, OLD.id, TG_OP, rec_old);
    RETURN OLD;
  END IF;
END;
$function$;

-- ============================================================
-- Source: 20260424195405_60f726b3-9111-4b12-8a00-568abac13642.sql
-- ============================================================
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

-- ============================================================
-- Source: 20260427215215_0faeed0c-88f0-4fb4-8e6e-69db2dc55e02.sql
-- ============================================================
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

-- ============================================================
-- Source: 20260427221807_2b85074e-0712-4020-9fa7-b2a1a930e105.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_audit_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_actor UUID;
  target_project UUID;
  rec_new JSONB;
  rec_old JSONB;
BEGIN
  current_actor := auth.uid();

  IF TG_OP <> 'DELETE' THEN
    rec_new := to_jsonb(NEW);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    rec_old := to_jsonb(OLD);
  END IF;

  IF TG_TABLE_NAME = 'projects' THEN
    -- For project rows, only attach project_id if the row still exists (not on DELETE).
    -- Otherwise the FK to projects would be violated within the same transaction.
    IF TG_OP = 'DELETE' THEN
      target_project := NULL;
    ELSE
      target_project := COALESCE((rec_new->>'id')::uuid, (rec_old->>'id')::uuid);
    END IF;
  ELSE
    target_project := COALESCE((rec_new->>'project_id')::uuid, (rec_old->>'project_id')::uuid);
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (project_id, actor_user_id, entity_type, entity_id, action, new_data)
    VALUES (target_project, current_actor, TG_TABLE_NAME, NEW.id, TG_OP, rec_new);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (project_id, actor_user_id, entity_type, entity_id, action, previous_data, new_data)
    VALUES (target_project, current_actor, TG_TABLE_NAME, NEW.id, TG_OP, rec_old, rec_new);
    RETURN NEW;
  ELSE
    INSERT INTO public.audit_logs (project_id, actor_user_id, entity_type, entity_id, action, previous_data)
    VALUES (target_project, current_actor, TG_TABLE_NAME, OLD.id, TG_OP, rec_old);
    RETURN OLD;
  END IF;
END;
$function$;

-- ============================================================
-- Source: 20260427225222_919f8e53-ffc1-40c1-a430-c6ab317bdb15.sql
-- ============================================================
ALTER TABLE public.budget_items
ADD COLUMN IF NOT EXISTS hierarchy_level integer,
ADD COLUMN IF NOT EXISTS parent_item_code text;

UPDATE public.budget_items
SET
  hierarchy_level = CASE
    WHEN item_code IS NULL OR btrim(item_code) = '' THEN NULL
    ELSE array_length(regexp_split_to_array(btrim(item_code), '\.'), 1)
  END,
  parent_item_code = CASE
    WHEN item_code IS NULL OR btrim(item_code) = '' OR position('.' in btrim(item_code)) = 0 THEN NULL
    ELSE regexp_replace(btrim(item_code), '\.[^.]+$', '')
  END
WHERE hierarchy_level IS NULL OR parent_item_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_budget_items_project_parent_code
ON public.budget_items (project_id, parent_item_code);

CREATE INDEX IF NOT EXISTS idx_budget_items_project_hierarchy_level
ON public.budget_items (project_id, hierarchy_level);

-- ============================================================
-- Source: 20260605061652_cefab4c0-0ed7-42f1-ba7e-1bb67233d7bd.sql
-- ============================================================
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

-- ============================================================
-- Source: 20260605061731_8a849961-2484-48a5-9c8d-cb710ed40f28.sql
-- ============================================================
DROP VIEW IF EXISTS public.v_my_projects;

CREATE VIEW public.v_my_projects
WITH (security_invoker = true) AS
SELECT p.id, p.code, p.name, p.status, pm.project_role, p.created_at
FROM public.projects p
JOIN public.project_members pm ON pm.project_id = p.id
WHERE pm.user_id = auth.uid();

GRANT SELECT ON public.v_my_projects TO authenticated;

-- ============================================================
-- Source: 20260605061756_f9725163-acb9-4894-94cf-48ecab577be7.sql
-- ============================================================
DO $$
DECLARE
  fn_name text;
  fn_sig text;
BEGIN
  FOR fn_sig IN
    SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn_sig);
  END LOOP;
END $$;

-- ============================================================
-- Source: 20260605063805_d15f9cff-bdd8-4141-8025-ac320d4a9441.sql
-- ============================================================

CREATE TYPE public.signature_document_type AS ENUM (
  'memoria_valorizada',
  'valuation',
  'liquidation',
  'expediente'
);

CREATE TABLE public.firmas_electronicas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_type public.signature_document_type NOT NULL,
  document_id UUID NOT NULL,
  signer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer_project_role public.project_role,
  content_hash TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  verification_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex') UNIQUE,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_firmas_doc ON public.firmas_electronicas (document_type, document_id);
CREATE INDEX idx_firmas_project ON public.firmas_electronicas (project_id);
CREATE INDEX idx_firmas_signer ON public.firmas_electronicas (signer_user_id);

GRANT SELECT, INSERT, UPDATE ON public.firmas_electronicas TO authenticated;
GRANT ALL ON public.firmas_electronicas TO service_role;

ALTER TABLE public.firmas_electronicas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Miembros del proyecto pueden ver firmas"
  ON public.firmas_electronicas FOR SELECT
  TO authenticated
  USING (public.can_view_project(project_id, auth.uid()));

CREATE POLICY "Usuario firma con su propio user_id"
  ON public.firmas_electronicas FOR INSERT
  TO authenticated
  WITH CHECK (
    signer_user_id = auth.uid()
    AND public.can_view_project(project_id, auth.uid())
  );

CREATE POLICY "Firmante o admin global pueden revocar"
  ON public.firmas_electronicas FOR UPDATE
  TO authenticated
  USING (signer_user_id = auth.uid() OR public.is_global_admin(auth.uid()))
  WITH CHECK (signer_user_id = auth.uid() OR public.is_global_admin(auth.uid()));

CREATE TRIGGER update_firmas_electronicas_updated_at
  BEFORE UPDATE ON public.firmas_electronicas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ============================================================
-- Source: 20260605065556_f4b00668-55a0-4d60-bec9-95228d989111.sql
-- ============================================================

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


-- ============================================================
-- Source: 20260605080406_a36235d9-f0bb-494d-aaf7-8d85b1c88e4e.sql
-- ============================================================
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


-- ============================================================
-- Source: 20260605081258_59439a0b-7d42-4810-a98a-67da8fd7ef05.sql
-- ============================================================

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_global_admin(auth.uid()));

CREATE POLICY notifications_insert_project ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.is_global_admin(auth.uid())
      OR (project_id IS NOT NULL AND public.can_view_project(project_id, auth.uid()))
      OR user_id = auth.uid()
    )
  );

CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX notifications_user_unread_idx
  ON public.notifications (user_id, read_at, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;


-- ============================================================
-- Source: 20260605182307_143aa0b8-7bad-4609-b6a5-0376cf0b29f0.sql
-- ============================================================
ALTER TABLE public.reajustes ADD COLUMN IF NOT EXISTS valuation_id uuid NULL; CREATE INDEX IF NOT EXISTS reajustes_valuation_id_idx ON public.reajustes(valuation_id);

-- ============================================================
-- Source: 20260605204650_d663be4d-c96a-46e3-bd93-d4a04df5d247.sql
-- ============================================================

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


-- ============================================================
-- Source: 20260606154548_f511fa67-e5ad-4f2b-9c09-20210488f9f6.sql
-- ============================================================

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


-- ============================================================
-- Source: 20260622180343_5f953fa4-e5cc-459f-9c28-81e6e8412be5.sql
-- ============================================================

-- Fase 1: Parámetros del formato peruano de valorización mensual (A–Q).

-- 1) PROJECTS: parámetros contractuales que aún no existen
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS overhead_percentage NUMERIC(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_percentage   NUMERIC(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS direct_advance_amount        NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS materials_advance_amount     NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS direct_advance_amortization_pct    NUMERIC(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS materials_advance_amortization_pct NUMERIC(7,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guarantee_retention_pct  NUMERIC(7,4) DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS guarantee_retention_mode TEXT DEFAULT 'per_valuation'
    CHECK (guarantee_retention_mode IN ('per_valuation','single')),
  ADD COLUMN IF NOT EXISTS reference_value_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS reference_value_date   DATE;

COMMENT ON COLUMN public.projects.overhead_percentage IS 'Gastos generales (%) sobre costo directo (0.08 = 8%)';
COMMENT ON COLUMN public.projects.profit_percentage IS 'Utilidad (%) sobre costo directo (0.07 = 7%)';
COMMENT ON COLUMN public.projects.guarantee_retention_pct IS 'Retención de garantía de fiel cumplimiento (0.10 = 10%)';
COMMENT ON COLUMN public.projects.guarantee_retention_mode IS 'per_valuation = se aplica en cada valorización; single = una sola vez';
COMMENT ON COLUMN public.projects.reference_value_amount IS 'Valor referencial incluido IGV (renglón "Valor Referencial" del formato)';
COMMENT ON COLUMN public.projects.reference_value_date IS 'Fecha del valor referencial (base para reajuste polinómico)';

-- 2) VALUATIONS: campos tipificados A–Q de la hoja de valorización
ALTER TABLE public.valuations
  ADD COLUMN IF NOT EXISTS direct_cost_amount      NUMERIC(14,2) DEFAULT 0, -- A
  ADD COLUMN IF NOT EXISTS overhead_amount         NUMERIC(14,2) DEFAULT 0, -- B
  ADD COLUMN IF NOT EXISTS profit_amount           NUMERIC(14,2) DEFAULT 0, -- C
  ADD COLUMN IF NOT EXISTS subtotal_amount         NUMERIC(14,2) DEFAULT 0, -- A+B+C
  ADD COLUMN IF NOT EXISTS reajuste_gross_amount   NUMERIC(14,2) DEFAULT 0, -- G
  ADD COLUMN IF NOT EXISTS reajuste_prev_reintegro NUMERIC(14,2) DEFAULT 0, -- H
  ADD COLUMN IF NOT EXISTS reajuste_drnc_amount    NUMERIC(14,2) DEFAULT 0, -- I
  ADD COLUMN IF NOT EXISTS subtotal_reajustado     NUMERIC(14,2) DEFAULT 0, -- J
  ADD COLUMN IF NOT EXISTS amort_direct_advance    NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amort_materials_advance NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ded_drnc_direct         NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ded_drnc_materials      NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deductions_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_deductions_amount NUMERIC(14,2) DEFAULT 0, -- K
  ADD COLUMN IF NOT EXISTS net_to_contractor       NUMERIC(14,2) DEFAULT 0, -- L
  ADD COLUMN IF NOT EXISTS igv_total_amount        NUMERIC(14,2) DEFAULT 0, -- N
  ADD COLUMN IF NOT EXISTS total_to_invoice        NUMERIC(14,2) DEFAULT 0, -- O
  ADD COLUMN IF NOT EXISTS retention_amount        NUMERIC(14,2) DEFAULT 0, -- P
  ADD COLUMN IF NOT EXISTS net_to_pay              NUMERIC(14,2) DEFAULT 0, -- Q
  ADD COLUMN IF NOT EXISTS prev_accumulated_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_accumulated_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reajuste_k_factor       NUMERIC(8,6);

COMMENT ON COLUMN public.valuations.direct_cost_amount IS 'A — Costo directo (suma de partidas valorizadas del mes)';
COMMENT ON COLUMN public.valuations.subtotal_amount IS 'A+B+C — Subtotal antes de reajuste';
COMMENT ON COLUMN public.valuations.reajuste_gross_amount IS 'G — Reajuste bruto mensual (K · monto)';
COMMENT ON COLUMN public.valuations.subtotal_reajustado IS 'J — Subtotal reajustado (G+H-I)';
COMMENT ON COLUMN public.valuations.total_deductions_amount IS 'K — Total deducciones (amortización adelantos + DRNC + otros)';
COMMENT ON COLUMN public.valuations.net_to_contractor IS 'L — Neto al contratista (J-K)';
COMMENT ON COLUMN public.valuations.total_to_invoice IS 'O — Total a facturar (L+N)';
COMMENT ON COLUMN public.valuations.retention_amount IS 'P — Retención garantía fiel cumplimiento';
COMMENT ON COLUMN public.valuations.net_to_pay IS 'Q — Monto a pagar al contratista (O-P)';
COMMENT ON COLUMN public.valuations.reajuste_k_factor IS 'Factor K aplicado en este período (proveniente del módulo de reajustes)';


