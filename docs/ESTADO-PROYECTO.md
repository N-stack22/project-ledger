# Documentación interna del proyecto — Estado real

> Última actualización: 2026-04-24
> Generado a partir del estado real del código y la base de datos.

## 1. Resumen ejecutivo

**Funciona end-to-end:**
- Login + sesión con Supabase Auth.
- CRUD de proyectos y ficha técnica completa.
- Carga del presupuesto (partidas) y registro de metrados detallados por período.
- Cálculo automático de valorización (actual, anterior, acumulada, saldo).
- Registro de deducciones del catálogo fijo.
- Generación del **PDF del Expediente Mensual en cliente** con `@react-pdf/renderer`, con tablas ya estructuradas (View + Text + anchos fijos).

**Funciona parcialmente:**
- El layout del PDF ya no tiene los bloques negros, pero las tablas de metrados detalladas y la valorización siguen siendo "funcionales" — no replican el formato oficial peruano 1:1 (sellos, firmas, encabezados institucionales).
- La narrativa técnica (generalidades, metas, ocurrencias, conclusiones) se guarda como texto plano en `valuation_periods`, no con editor enriquecido.
- Memoria valorizada y valorizaciones formales (`valuations` + `valuation_lines`) existen como tablas con triggers de validación, pero el flujo del Expediente NO los está poblando — usa directamente `metrado_lines` + `valuation_periods` + `valuation_deductions`.

**No terminado:**
- Liquidación final (tabla existe, UI placeholder).
- Workflow de aprobaciones (`workflow_comments` existe, sin UI activa).
- Persistencia del PDF generado en el bucket `expedientes` y registro en `expediente_documents` (hoy se descarga local, no se sube).
- Importación masiva de presupuesto desde Excel (bucket `budget-imports` existe, parsing real no implementado).

**Flujo principal operativo hoy:**
Login → crear proyecto → completar ficha técnica → cargar partidas manualmente → crear período de valorización → registrar líneas de metrado (con fórmula o dimensiones) → registrar deducciones → generar PDF descargable.

---

## 2. Arquitectura actual

**Stack real verificado:**
- **Framework:** TanStack Start v1 (no Next.js, no Remix). Vite 7 como bundler.
- **Runtime SSR:** Cloudflare Workers (edge) con `nodejs_compat` — esto fue **decisivo** para el PDF.
- **Frontend:** React 19, Tailwind v4 (vía `src/styles.css` con `@import` y tokens `oklch`), shadcn/ui, lucide-react, sonner para toasts.
- **Routing:** file-based en `src/routes/`, plano con notación `app.expediente.tsx`.
- **Backend:** Supabase (Lovable Cloud) — Postgres + Auth + Storage + RLS. **No hay edge functions propias activas** para el flujo del expediente (se eliminaron por incompatibilidad con Wasm).
- **PDF:** `@react-pdf/renderer` ejecutándose **100% en cliente**.

**Conexión UI ↔ DB:**
Cliente Supabase (`src/integrations/supabase/client.ts`) consumido directamente desde rutas y desde `workspace-provider.tsx`, que hace de "store" centralizado (carga proyectos, partidas, perfil, roles). RLS hace el filtrado por usuario, no se filtra en frontend.

**Autenticación:**
- `src/lib/auth.tsx` provee `AuthProvider` con `supabase.auth.getSession()` + listener `onAuthStateChange`.
- `src/components/app/auth-guard.tsx` envuelve `/app/*` y redirige a `/login` si no hay sesión.
- Login es email/password estándar. **Google OAuth no está configurado.**
- La ruta `/app` (`app.tsx`) monta el shell + guard + workspace.

**Permisos:**
- Tabla `user_roles` separada del perfil (correcto, sin recursión).
- Enum `app_role`: `admin`, `assistant`, `resident`, `supervisor`, `legal_representative`.
- Funciones `SECURITY DEFINER`: `has_role`, `has_any_role`, `is_project_member`, `can_view_project`, `can_edit_project_data`, `can_review_project_data`. Todas las RLS las llaman para evitar recursión.
- Bootstrap: el primer usuario registrado se vuelve `admin` automáticamente vía trigger `handle_new_user_role_bootstrap`.

**Generación PDF:**
Cliente. `src/lib/expediente-client-pdf.tsx` arma el `<Document>` con `pdf().toBlob()` y dispara descarga programática vía `<a download>`.

**Decisiones técnicas y por qué:**

| Decisión | Razón | Alternativa descartada |
|---|---|---|
| PDF en cliente con react-pdf | El Worker no permite WebAssembly (`Wasm code generation disallowed by embedder`) — falló en server | react-pdf/renderer en server function; jsPDF (probado, layout pésimo) |
| Server functions sin edge function dedicada para PDF | Misma restricción Wasm | Edge function de Supabase (mismo problema) |
| `metrado_lines` aparte de `metrado_entries` | El expediente requiere desglose con fórmula/dimensiones; `metrado_entries` solo guarda cantidad agregada | Reutilizar `metrado_entries` (insuficiente para planillas) |
| Catálogo fijo de deducciones (enum) | Alcance v1, evita CRUD de configuración | Tabla parametrizable |
| Cliente Supabase directo, no API REST propia | RLS protege todo, evita capa intermedia | Edge functions como gateway |

**Limitaciones del entorno:**
- No Wasm en server → cualquier librería que lo use (sharp, react-pdf con renderToBuffer en Node) no funciona en producción.
- 1000 filas por query Supabase (no ha sido problema todavía).
- No hay cron / scheduler.

---

## 3. Estructura del código

```
src/
├── routes/
│   ├── __root.tsx              (73 l)  — Shell HTML, providers, error/notFound globales
│   ├── index.tsx               (57 l)  — Landing
│   ├── login.tsx               (6 l)   — Re-export de página en workspace-pages
│   ├── app.tsx                 (15 l)  — Layout autenticado: AuthGuard + WorkspaceProvider + AppShell + Outlet
│   ├── app.expediente.tsx      (619 l) — ÚNICA ruta con lógica completa propia (5 pasos)
│   └── app.{dashboard,projects,budgets,metrados,valuations,memorias,
│            documents,approvals,liquidation,reports,users,settings}.tsx
│                                       — Todas re-exportan páginas de workspace-pages.tsx
├── lib/
│   ├── auth.tsx                (124 l) — AuthProvider, useAuth
│   ├── domain.ts               (74 l)  — Type aliases desde Database, parseRichTextDocument
│   ├── business.ts             (519 l) — Helpers de cálculo de negocio (totales, métricas dashboard)
│   ├── expediente.ts           (154 l) — Cálculos puros: computeLinePartial, buildValuationTable, totals, formatMoney
│   ├── expediente-client-pdf.tsx (429 l) — Generador PDF react-pdf con Table component reusable
│   └── utils.ts                (6 l)   — cn() de shadcn
├── components/app/
│   ├── app-shell.tsx           (181 l) — Sidebar + topbar + navegación
│   ├── auth-guard.tsx          (43 l)  — Redirect si no hay sesión
│   ├── workspace-provider.tsx  (174 l) — Carga global de projects, budgetItems, profile, role
│   ├── workspace-pages.tsx     (1202 l) — TODAS las páginas (proyectos, presupuestos, metrados, etc.) en un solo archivo
│   ├── page-layout.tsx         (18 l)  — Wrapper de página con título
│   └── rich-text-editor.tsx    (68 l)  — Editor básico (no usado en expediente)
└── integrations/supabase/      — Auto-generado, NO tocar
```

**Arquitectura del Expediente Mensual (módulo principal):**

`app.expediente.tsx` es un wizard de 5 pasos con state local:
1. **Step 1**: selección de proyecto + período (carga `valuation_periods`, permite crear nuevo).
2. **Step 2**: planilla de metrados — agrupa `metrado_lines` por `item_id`, permite agregar/editar/borrar líneas con dimensiones o fórmula.
3. **Step 3**: textos de narrativa (generalidades, metas, ocurrencias, conclusiones) → guardados en `valuation_periods`.
4. **Step 4**: deducciones — CRUD sobre `valuation_deductions`.
5. **Step 5**: vista previa de la tabla de valorización (calculada en cliente con `buildValuationTable`) + botón "Generar PDF".

Todo el state vive en componente. **No hay React Query**, todo es `useEffect` + `supabase.from(...).select()` ad-hoc.

**Server functions:** prácticamente ninguna activa. Existió `src/lib/expediente-pdf.functions.ts` con `createServerFn` para generar PDF, pero **fue eliminada** tras el error de Wasm. Hoy el flujo de PDF no toca server.

---

## 4. Modelo de datos completo

Según el esquema verificado en BD, hay **15 tablas**. Las marcadas con ⭐ las usa el expediente directamente.

### 4.1 `projects` ⭐ — Proyectos y ficha técnica
**Propósito:** entidad raíz. Todos los demás registros referencian `project_id`.
**Campos clave:**
- Identidad: `code`, `name`, `description`, `status` (`draft|active|closing|closed`), `progress_percent`.
- Contrato: `contract_type` (enum), `contract_amount`, `currency_code` (default PEN), `start_date`, `planned_end_date`, `actual_end_date`, `started_at`.
- **Ficha técnica (campos añadidos para expediente):** `entity_name`, `executing_unit`, `execution_modality`, `contractor_name`, `execution_contract`, `supervision_contract`, `subgerente_name`, `resident_name`, `supervisor_name`, `district`, `province`, `department`, `execution_term_days`, `planned_completion_date`, `new_completion_date`, `expediente_amount`, `direct_cost`, `overhead_cost`, `utility_amount`, `igv_amount`, `additionals_amount`, `deductives_amount`, `extensions_days`.
- `created_by` → relación lógica con `auth.users` (no FK).
**Trigger:** `prevent_contract_type_change_after_start` impide cambiar `contract_type` si el proyecto ya inició.
**Estado:** ✅ Lista. Modificada varias veces para añadir campos de ficha técnica.

### 4.2 `budget_items` ⭐ — Partidas del presupuesto base
**Propósito:** catálogo de partidas con metrado base y precio unitario.
**Campos:** `item_code`, `description`, `unit`, `base_quantity`, `unit_price`, `partial_amount`, `category`, `sort_order`, `budget_import_id`.
**Estado:** ✅ Lista. Usa `category` para agrupar (no hay tabla de jerarquía).

### 4.3 `budget_imports` — Cargas masivas Excel
Tabla preparada con bucket `budget-imports`, pero **el parser no está implementado**. Hoy se cargan partidas a mano.

### 4.4 `valuation_periods` ⭐ — Períodos de valorización (mensuales)
**Propósito:** ventana temporal de un expediente mensual.
**Campos:** `period_number`, `date_from`, `date_to`, `status`, y **textos narrativos** del expediente: `carta_presentacion`, `resumen_ejecutivo`, `generalidades`, `metas`, `ocurrencias`, `conclusiones`.
**Estado:** ✅ Lista. Esta tabla es el "contenedor" del expediente.

### 4.5 `metrado_lines` ⭐ — Líneas detalladas de planilla
**Propósito:** desglose de cómputos métricos por partida y por período.
**Campos:** `item_id`, `period_id`, `group_label`, `location_ref`, `description`, `num_elements`, `length`, `width`, `height`, `formula`, `partial`, `observation`, `sort_order`.
**Cálculo:** `partial` se calcula en cliente con `computeLinePartial` y se persiste.
**Estado:** ✅ Lista. Es la tabla central del módulo metrados.

### 4.6 `metrado_entries` — Metrados agregados (legacy/paralelo)
Existe con su propia validación (`validate_valuation_creation` la requiere). **El flujo actual del expediente NO la usa**: es para el flujo "valorización formal" (`valuations`) que está sin UI activa. ⚠️ Inconsistencia conocida.

### 4.7 `valuation_deductions` ⭐ — Deducciones del período
**Campos:** `period_id`, `deduction_type` (enum), `description`, `amount`, `percentage`.
**Estado:** ✅ Lista.

### 4.8 `memoria_valorizada` — Memoria descriptiva
Tabla preparada con `content_json`, `executive_summary`, status workflow. **No tiene UI activa** en el flujo del expediente (la narrativa hoy se guarda en `valuation_periods`).

### 4.9 `valuations` + `valuation_lines` — Valorización formal
Pensadas para el flujo formal con aprobaciones (residente → supervisor). Tienen triggers que exigen memoria aprobada y metrados validated. **No las usa el módulo expediente actual** (el expediente calcula en vivo desde `metrado_lines`). Otra inconsistencia.

### 4.10 `liquidations`
Tabla con trigger `validate_liquidation_creation` (proyecto en closing/closed + valuations approved). **Sin UI funcional**.

### 4.11 `expediente_documents`
Tabla destino para registrar PDFs generados (bucket `expedientes`). **No se está poblando hoy** porque el PDF se genera en cliente y no se sube.

### 4.12 Soporte
- `profiles` — datos de usuario, autoinsert por trigger `handle_new_user_profile`.
- `user_roles` — roles separados (correcto, sin recursión).
- `project_members` — membresía a proyectos.
- `audit_logs` — alimentado por trigger `log_audit_event` (configurable por tabla).
- `workflow_comments` — comentarios de aprobación, sin UI.

**Errores de schema durante el desarrollo:**
- `record "new" has no field "project_id"` apareció cuando el trigger `log_audit_event` se intentó aplicar a `projects` con la lógica genérica `new.project_id`. Se resolvió con el `IF TG_TABLE_NAME = 'projects'` que usa `new.id`.
- Varios errores de `new row violates row-level security policy` en INSERT de `metrado_lines` y `valuation_deductions` — causa: el `WITH CHECK` exige `created_by = auth.uid()` y la UI no lo enviaba. Resuelto añadiendo `created_by: user.id` en cada insert del frontend.

---

## 5. Flujo funcional implementado (paso a paso)

1. **Crear proyecto** (`/app/projects`): formulario con `code`, `name`, `contract_type`, `contract_amount`. Inserta con `created_by = auth.uid()`. Se vuelve miembro automáticamente vía RLS de `project_members`.
2. **Editar ficha técnica** (`/app/projects` → Editar): formulario completo con todos los campos de la ficha. Validado contra `isFichaTecnicaIncomplete` (helper exportado).
3. **Cargar partidas** (`/app/budgets`): manual hoy, una por una. Importación Excel pendiente.
4. **Crear período** (`/app/expediente` step 1): se crea `valuation_periods` con `period_number` autoincremental local + rango de fechas.
5. **Registrar metrados** (step 2): por partida, agregar líneas con dimensiones (N, L, A, H) o fórmula libre. `computeLinePartial` calcula en vivo y se persiste en `metrado_lines.partial`.
6. **Hoja resumen**: se calcula on-the-fly agrupando líneas por `item_id` (no hay tabla resumen).
7. **Narrativa** (step 3): textos a `valuation_periods`.
8. **Deducciones** (step 4): CRUD sobre `valuation_deductions` con tipo del catálogo fijo.
9. **Resumen y PDF** (step 5): `buildValuationTable` calcula prev/current/accum/balance comparando líneas del período actual contra todos los períodos anteriores cargados (`allPeriodLines`). Click en "Generar PDF" → `generateExpedienteClientPdf` → blob → descarga.

**Datos pedidos vs calculados:**
- Pedidos: ficha técnica, partidas, dimensiones de líneas, narrativa, deducciones.
- Calculados: parcial de línea, total por partida, % avance, montos prev/current/accum/balance, monto neto (`total valorizado − deducciones`).

**Validaciones por paso:**
- Step 1: requiere proyecto + período.
- Pre-PDF: `validateExpedienteData` verifica 10 campos de ficha + presencia de partidas + presencia de líneas. Si falta algo, muestra exactamente qué falta y bloquea generación.

---

## 6. Módulo de metrados (detalle)

- **Modelo:** una `metrado_lines` por línea de planilla; muchas por partida y período.
- **Campos por línea:** `group_label` (subgrupo libre), `location_ref` (calle/tramo/cuadra), `description`, `num_elements` (N), `length`, `width`, `height`, `formula` (texto), `partial` (calculado), `observation`.
- **Cálculo (`computeLinePartial`):**
  - Si hay `formula`: sustituye L/A/H/N por valores y evalúa con `Function()` (sandbox limitado a `[\d+\-*/().\s]`).
  - Si no: producto de los factores presentes (`N × L × A × H`, omitiendo nulls).
  - Redondea a 4 decimales.
- **Unidades:** vienen de `budget_items.unit` (texto libre). El sistema **no valida coherencia dimensional** (un m³ con solo L×A no se detecta).
- **Resumen:** se reduce en vivo con `Map<item_id, suma>`, no persistido.
- **Casos cubiertos:** geometría rectangular, fórmulas aritméticas simples, ubicación libre.
- **Casos NO cubiertos:** áreas trapezoidales/triangulares no evaluables sin fórmula manual; sin import Excel; sin validación de unidad vs dimensiones; sin imágenes/croquis adjuntos.

---

## 7. Módulo de valorización

`buildValuationTable` (en `expediente.ts`) recibe `items`, `currentLines`, `previousLines` y por cada partida calcula:

- `qtyPrev`: suma de partials de períodos anteriores.
- `qtyCurrent`: suma de partials del período actual.
- `qtyAccum = qtyPrev + qtyCurrent`.
- `qtyBalance = max(base_quantity − qtyAccum, 0)`.
- `amount* = qty* × unit_price`.
- `pct* = qty* / base_quantity × 100`.

`totals()` agrega los totales del cuadro.

- **Conexión metrados ↔ precio:** vía `item_id` → `budget_items.unit_price`.
- **Jerarquía:** plana, ordenada por `sort_order`. **No hay árbol de partidas** (titular/subpartida).
- **Costos unitarios:** soportado a nivel de cálculo. **Adicionales/deductivos** existen como campos en `projects` pero no se incorporan al cuadro de valorización todavía.
- **Editable vs auto:** todo es automático a partir de líneas; el usuario edita líneas, no celdas del cuadro.

---

## 8. Deducciones

- **Catálogo fijo** (no parametrizable), enum en `deduction_type`:
  - `adelanto_directo`, `adelanto_materiales`, `fondo_garantia`, `reintegro`, `multa`, `penalidad`, `otra`.
- **Labels** en `deductionLabels` (`expediente.ts`) — mapping hardcoded.
- **Almacenamiento:** `valuation_deductions` con `period_id`, `amount`, `percentage` (opcional, no se está usando), `description`.
- **Cálculo:** suma simple de `amount` por período.
- **Efecto en neto:** `netAmount = totales.current − totalDeductions`.
- **En PDF:** sección dedicada con tabla de deducciones y monto neto resaltado.

---

## 9. Generación del PDF

**Motor final:** `@react-pdf/renderer` en cliente.

**Histórico de decisión:**
1. v1: `@react-pdf/renderer` en server function → `WebAssembly.instantiate(): Wasm code generation disallowed by embedder`. El Worker (Cloudflare) bloquea Wasm.
2. v2: migración a `jsPDF` cliente → funcionaba pero layout de tablas pésimo (bloques negros, columnas superpuestas).
3. v3 (actual): `@react-pdf/renderer` en cliente con componentes estructurados.

**Dónde:** `src/lib/expediente-client-pdf.tsx` exporta `generateExpedienteClientPdf(args)` que usa `pdf(<Document/>).toBlob()` y devuelve `{url, fileName}`.

**Estructura interna del documento:**
- Portada (proyecto, período, código, monto contractual).
- Índice.
- Ficha técnica (tabla 2 columnas).
- Informe técnico (textos de narrativa).
- Hoja resumen de metrados (tabla agrupada por partida).
- Planillas detalladas por partida (tabla por partida con líneas, landscape).
- Cuadro de valorización (landscape, 11 columnas: código, descripción, unidad, cantidad base, prev, actual, accum, balance, %).
- Deducciones y monto neto.

**Componente `Table` reutilizable** con `cols` (label, key, width fijo), header `fixed={true}` y filas `wrap={false}`.

**Validación pre-render:** `validateExpedienteData` lista campos faltantes con etiquetas legibles y aborta con error visible.

**Layout — estado actual:**
- ✅ Bloques negros resueltos (eran del overflow de jsPDF).
- ✅ Anchos de columna fijos calibrados para portrait (531pt) y landscape (794pt).
- ⚠️ Aún puede haber clipping de texto en descripciones muy largas — falta `Text` con wrap más agresivo o ellipsis.
- ⚠️ No hay numeración de páginas en el formato oficial peruano (folio).
- ⚠️ Sin sellos, firmas, encabezado institucional (logo entidad, etc.).
- ⚠️ Tipografía default (Helvetica) — formato oficial usa Arial/Times.

**Para que se vea idéntico al expediente real falta:**
1. Plantilla con encabezado/pie institucional configurable por proyecto.
2. Bloques de firmas (residente, supervisor, subgerente).
3. Numeración tipo "Folio N°".
4. Logo de la entidad (subido por proyecto).
5. Tipografía corporativa.

---

## 10. Validaciones y reglas de negocio

**Implementadas en código (UI):**
- `isFichaTecnicaIncomplete(project)` → bloquea pasos posteriores con CTA "Completar ficha técnica".
- `validateExpedienteData()` pre-PDF → lista exacta de faltantes.
- Form de proyecto exige `code`, `name`, `contract_type`, `contract_amount`.

**Implementadas en BD (triggers):**
- `prevent_contract_type_change_after_start` — no cambiar tipo de contrato post-inicio.
- `validate_valuation_creation` — exige memoria aprobada + metrados validated (relevante para flujo formal, no del expediente actual).
- `validate_liquidation_creation` — proyecto en closing + valuations approved.
- `log_audit_event` — auditoría automática.

**Planteadas pero NO implementadas:**
- Validación de coherencia dimensional (m² requiere L+A, m³ requiere L+A+H).
- Que el período no se solape con otro existente.
- Que `qtyAccum` no exceda `base_quantity` con bloqueo (hoy solo se ve en saldo=0).
- Aprobación residente → supervisor del expediente.
- Adicionales/deductivos contra cuadro.

---

## 11. Seguridad y permisos

**Login:** Supabase Auth (email/password). Sesión persistida con `localStorage`. Listener `onAuthStateChange` actualiza `AuthProvider`.

**Roles (enum `app_role`):**
- `admin` — acceso total.
- `resident` — edita data del proyecto si es miembro.
- `assistant` — edita data del proyecto si es miembro.
- `supervisor` — revisa/aprueba (no edita data base).
- `legal_representative` — solo lectura.

**Funciones de permisos (SECURITY DEFINER):**
- `can_view_project`: admin OR member OR legal_representative.
- `can_edit_project_data`: admin OR (resident/assistant + member).
- `can_review_project_data`: admin OR (resident/supervisor + member).
- `is_project_member`, `has_role`, `has_any_role`.

**RLS** aplicado en todas las tablas usando estas funciones — **sin recursión** (los policies no consultan la tabla protegida).

**Errores de permisos resueltos:**
- `new row violates row-level security policy` en `metrado_lines` / `valuation_deductions`: causa: `WITH CHECK` exige `created_by = auth.uid()` y los inserts no lo enviaban. ✅ Resuelto añadiendo `created_by: user.id` en cliente.
- `record "new" has no field "project_id"` en trigger de auditoría sobre `projects`: la lógica genérica intentaba leer `NEW.project_id`. ✅ Resuelto con condicional por `TG_TABLE_NAME` (usa `NEW.id` en projects).
- Recursión inicial en RLS resuelta migrando a funciones SECURITY DEFINER.

---

## 12. Problemas encontrados durante el desarrollo

| # | Problema | Causa | Solución | Estado |
|---|---|---|---|---|
| 1 | "Falta editar proyecto en UI" | Validación de ficha técnica sin ruta para completarla | Botón "Completar ficha técnica" + form de edición en projects | ✅ Resuelto |
| 2 | Botón "Generar PDF" sin acción | Falta auth header en server function | Pasar `accessToken` explícito | ✅ Resuelto (luego obsoleto) |
| 3 | `WebAssembly disallowed by embedder` | react-pdf usa Wasm en server, Worker lo bloquea | Migrar PDF a cliente | ✅ Resuelto |
| 4 | jsPDF: bloques negros, columnas rotas | Layout manual con coordenadas absolutas | Migrar a react-pdf cliente con View+Text | ✅ Resuelto |
| 5 | RLS violations en inserts | Falta `created_by` en payload | Añadir `auth.uid()` en cada insert | ✅ Resuelto |
| 6 | Trigger audit `no project_id` | Lógica genérica en tabla projects | Condicional `TG_TABLE_NAME` | ✅ Resuelto |
| 7 | `metrado_entries` vs `metrado_lines` divergentes | Dos modelos para metrados, expediente solo usa uno | **No resuelto** — duplicidad conceptual viva | ⚠️ Workaround |
| 8 | `valuations` formal sin uso desde expediente | Flujo formal queda huérfano | **No resuelto** — flujo paralelo no integrado | ⚠️ |
| 9 | PDF no se sube a `expedientes` bucket | Tabla `expediente_documents` no se puebla | Pendiente | ❌ Pendiente |

---

## 13. Estado actual real por módulo

| Módulo | Estado |
|---|---|
| Auth (login, sesión, guard) | ✅ Listo y funcionando |
| Roles + RLS | ✅ Listo |
| Proyectos (CRUD + ficha técnica) | ✅ Listo |
| Presupuesto (carga manual de partidas) | ✅ Funciona pero incompleto (falta import Excel) |
| Importación Excel de presupuesto | ❌ Existe en UI, no conectado |
| Períodos de valorización | ✅ Listo |
| Metrados detallados (líneas con fórmula) | ✅ Listo |
| Hoja resumen de metrados | ✅ Listo (calculado en vivo) |
| Cuadro de valorización | ✅ Listo (cálculo correcto prev/curr/accum) |
| Deducciones | ✅ Listo (catálogo fijo) |
| Narrativa técnica | ⚠️ Funciona pero solo texto plano, sin editor enriquecido |
| Generación PDF | ⚠️ Funciona, formato no oficial 1:1 |
| Persistencia PDF en storage | ❌ Pendiente |
| Memoria valorizada formal | ❌ Tabla existe, sin UI activa |
| Valorizaciones formales (`valuations`) | ❌ Tabla existe, sin UI activa |
| Aprobaciones / workflow_comments | ❌ Pendiente |
| Liquidación | ❌ Pendiente crítico |
| Dashboard | ⚠️ UI básica, métricas estáticas |
| Reports | ❌ Placeholder |
| Auditoría visible | ⚠️ Se registra, no hay UI para ver logs |

---

## 14. Qué falta para producción

**Estabilidad:**
- Persistir PDF en bucket `expedientes` + registrar en `expediente_documents`.
- React Query o equivalente para invalidación de cachés (hoy `useEffect` manual).
- Manejar conflictos de concurrencia en `valuation_periods` (dos usuarios editando el mismo período).
- Tests automatizados (no hay ninguno).

**PDF presentable:**
- Encabezado institucional con logo configurable.
- Bloques de firma con nombre + cargo + espacio para firma.
- Tipografía y márgenes oficiales.
- Numeración de folio.
- Mejorar wrap de descripciones largas en tablas.

**Flujo completo:**
- Resolver duplicidad `metrado_entries` vs `metrado_lines` (decidir cuál es la fuente).
- Conectar `valuations` formales con el flujo del expediente o eliminar la tabla.
- UI de aprobaciones residente → supervisor.
- Liquidación final.

**Seguridad:**
- Confirmación de email obligatoria (hoy puede estar deshabilitada).
- Rate limiting en endpoints públicos (no hay endpoints públicos hoy).
- Política de contraseñas.
- Revisar que `audit_logs` cubra todas las tablas críticas.

**Datos:**
- Importador Excel real para presupuesto.
- Migración / seed de datos de ejemplo.
- Backup/export de proyectos.

**UX:**
- Editor enriquecido para narrativa.
- Validación dimensional vs unidad.
- Vista previa del PDF antes de descargar.
- Indicadores de progreso en pasos del wizard.
- Modo móvil (hoy todo asume desktop).

**Pruebas:**
- E2E del flujo completo expediente.
- Tests de cálculo (`computeLinePartial`, `buildValuationTable`).
- Verificación visual del PDF por snapshot.

---

## 15. Próximos pasos recomendados

**🔴 Prioridad crítica (para hosting):**
1. Persistir PDF generado en bucket `expedientes` + registrar `expediente_documents` (sin esto no hay trazabilidad).
2. Resolver duplicidad `metrado_entries`/`metrado_lines` — decidir y eliminar el sobrante.
3. Plantilla PDF con encabezado/firmas oficial (lo que valida o invalida el entregable real).
4. Confirmación de email + política de contraseñas en Auth.

**🟠 Prioridad alta:**
5. Importador Excel de presupuesto.
6. UI de aprobación residente → supervisor (workflow_comments + estado en período).
7. Editor enriquecido para narrativa técnica.
8. React Query para todo el data fetching (estabilidad y revalidación).

**🟡 Prioridad media:**
9. Validación dimensional vs unidad en metrados.
10. Vista previa del PDF dentro de la app.
11. Liquidación final (UI sobre tabla `liquidations`).
12. Dashboard con métricas reales.

**🟢 Mejoras futuras:**
13. Adicionales/deductivos integrados al cuadro.
14. Imágenes/croquis adjuntos por línea de metrado.
15. Multi-moneda y conversión.
16. Exportación a Excel del cuadro de valorización.
17. Versionado del expediente con diff entre versiones.
18. Tests E2E.
