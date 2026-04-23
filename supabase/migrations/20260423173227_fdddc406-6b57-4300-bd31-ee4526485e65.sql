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