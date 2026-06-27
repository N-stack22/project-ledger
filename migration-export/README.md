# Migración a Supabase externo

Este paquete contiene **todo el esquema** del proyecto (tablas, índices, funciones, triggers, RLS, enums, buckets de Storage) consolidado en un solo archivo SQL listo para ejecutar en tu propio proyecto de Supabase.

## Contenido

- `00_full_schema.sql` — concatenación ordenada de las 19 migraciones del proyecto (`supabase/migrations/`). Incluye:
  - Enums (`app_role`, `project_role`, `global_role`, `contract_type`, `project_status`, `entry_status`, `document_status`, `valuation_status`, `liquidation_status`, `workflow_action`, `workflow_entity`).
  - Tablas (`profiles`, `projects`, `project_members`, `user_roles`, `user_global_roles`, `budget_imports`, `budget_items`, `metrado_lines`, `valuation_periods`, `valuation_deductions`, `memoria_valorizada`, `valuations`, `valuation_lines`, `liquidations`, `workflow_comments`, `firmas_electronicas`, `inei_indices`, `polynomial_formulas`, `reajustes`, `notifications`, `expediente_documents`, `audit_logs`).
  - Índices, FKs y triggers (`updated_at`, auditoría, validaciones de valorización/liquidación, bootstrap de roles/perfil).
  - Funciones `SECURITY DEFINER` (`has_role`, `has_global_role`, `is_global_admin`, `is_project_member`, `has_project_role`, `has_any_project_role`, `can_view_project`, `can_edit_project_data`, `can_review_project_data`, `project_is_empty`, `log_audit_event`, `validate_valuation_creation`, `validate_liquidation_creation`, `update_updated_at_column`, `handle_new_user_profile`, `handle_new_user_role_bootstrap`, `prevent_contract_type_change_after_start`).
  - Políticas RLS por tabla.
  - Buckets de Storage (`expedientes`, `project-documents`, `budget-imports`) y sus políticas en `storage.objects`.

> No hay datos seed obligatorios. El catálogo de índices INEI se carga desde la UI (Reajustes → Importar CSV) y los roles globales se asignan tras crear el primer usuario.

## Pasos para migrar

### 1. Crea un proyecto nuevo en Supabase
- Anota `Project URL`, `anon public key` y (opcional) `service_role key`.

### 2. Ejecuta el esquema
En el SQL Editor de tu proyecto, pega y ejecuta `00_full_schema.sql` **completo**.
Si Supabase corta por tamaño, divídelo en bloques siguiendo los comentarios `-- Source:`.

### 3. Configura Auth
- Authentication → Providers → habilita **Email** (y Google si lo usas).
- Authentication → URL Configuration → agrega tu dominio en *Site URL* y *Redirect URLs*.
- Confirma que el trigger `on_auth_user_created` (creado por el esquema) inserta el perfil y el rol `usuario_registrado` por defecto.

### 4. Asigna el primer admin
Después de registrarte:
```sql
insert into public.user_global_roles (user_id, role)
values ('<TU_USER_ID>', 'super_admin')
on conflict do nothing;
```

### 5. Actualiza variables de entorno

Edita `.env` en el proyecto:

```env
VITE_SUPABASE_URL="https://<TU_PROYECTO>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<TU_ANON_KEY>"
VITE_SUPABASE_PROJECT_ID="<TU_PROJECT_REF>"

# Solo necesarias si despliegas server functions / SSR fuera de Lovable
SUPABASE_URL="https://<TU_PROYECTO>.supabase.co"
SUPABASE_PUBLISHABLE_KEY="<TU_ANON_KEY>"
SUPABASE_SERVICE_ROLE_KEY="<TU_SERVICE_ROLE_KEY>"
```

El cliente (`src/integrations/supabase/client.ts`) ya lee estas variables — no requiere cambios de código.

### 6. (Opcional) Datos existentes
Si quieres llevarte los datos actuales, expórtalos por tabla desde el SQL Editor actual:
```sql
copy (select * from public.projects) to stdout with csv header;
```
…y reimporta en el proyecto nuevo con `\copy` o el importador CSV del Dashboard. Importa en este orden para respetar FKs:

1. `profiles` → `user_global_roles` → `user_roles`
2. `projects` → `project_members`
3. `budget_imports` → `budget_items`
4. `valuation_periods` → `metrado_lines` → `valuation_deductions`
5. `memoria_valorizada` → `valuations` → `valuation_lines`
6. `liquidations` → `firmas_electronicas` → `expediente_documents`
7. `inei_indices` → `polynomial_formulas` → `reajustes`
8. `workflow_comments` → `notifications` → `audit_logs`

### 7. Verifica
```sql
select tablename from pg_tables where schemaname = 'public' order by 1;
select name from storage.buckets;
select proname from pg_proc where pronamespace = 'public'::regnamespace order by 1;
```

Listo: la app apunta a tu Supabase y mantiene toda la lógica (RLS, workflow, reajustes, expediente PDF, notificaciones).
