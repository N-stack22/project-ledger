
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
