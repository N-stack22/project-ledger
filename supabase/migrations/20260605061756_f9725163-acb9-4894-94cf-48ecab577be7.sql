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