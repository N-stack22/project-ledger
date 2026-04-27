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