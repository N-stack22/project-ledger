
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
