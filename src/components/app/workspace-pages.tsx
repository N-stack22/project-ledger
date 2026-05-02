import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { purgeProject } from "@/lib/projects.purge.functions";
import { ThemeToggle as LoginThemeToggle } from "@/components/app/theme-toggle";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/components/app/workspace-provider";
import { cipLookup } from "@/lib/cip-lookup.functions";
import { Search as SearchIcon, Loader2 } from "lucide-react";
import { PageLayout } from "@/components/app/page-layout";
import { RichTextEditor } from "@/components/app/rich-text-editor";
import {
  buildAuditSummary,
  buildDashboardMetrics,
  calculateProjectProgress,
  contractTypeLabels,
  detectBudgetWorkbook,
  documentStatusLabels,
  exportFinancialWorkbook,
  exportLiquidationPdf,
  exportMemoriaPdf,
  exportMetradosWorkbook,
  exportValuationPdf,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  getPeriodLabel,
  projectStatusLabels,
  roleLabels,
  toPeriodDate,
  valuationStatusLabels,
} from "@/lib/business";
import { parseRichTextDocument, stripHtml, type BudgetItemRow } from "@/lib/domain";
import { buildParentCodeSet, isLeafByCode } from "@/lib/expediente";
import { AuthGuard } from "@/components/app/auth-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const projectSchema = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(3).max(160),
  client_name: z.string().trim().max(120).optional(),
  location: z.string().trim().max(160).optional(),
  contract_type: z.enum(["precios_unitarios", "suma_alzada"], {
    errorMap: () => ({ message: "Selecciona un tipo de contrato válido." }),
  }),
  contract_amount: z.coerce.number().min(0),
  status: z.enum(["draft", "active", "closing", "closed"]),
  start_date: z.string().optional(),
});

const fichaTecnicaSchema = z
  .object({
    entity_name: z.string().trim().max(180).optional(),
    contractor_name: z.string().trim().max(180).optional(),
    supervisor_name: z.string().trim().max(180).optional(),
    resident_name: z.string().trim().max(180).optional(),
    execution_modality: z.string().trim().max(120).optional(),
    location: z.string().trim().max(180).optional(),
    execution_contract: z.string().trim().max(180).optional(),
    supervision_contract: z.string().trim().max(180).optional(),
    contract_amount: z.coerce.number().min(0),
    start_date: z.string().optional(),
    execution_term_days: z.coerce.number().int().min(0).optional(),
    planned_end_date: z.string().optional(),
    status: z.enum(["draft", "active", "closing", "closed", "archived", "cancelled"]),
  })
  .superRefine((values, ctx) => {
    const { start_date, planned_end_date, execution_term_days } = values;
    if (start_date && planned_end_date) {
      const start = new Date(start_date);
      const end = new Date(planned_end_date);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
      if (end < start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["planned_end_date"],
          message: "La fecha de término debe ser posterior a la fecha de inicio.",
        });
        return;
      }
      const computed = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
      if (execution_term_days && execution_term_days > 0 && execution_term_days !== computed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["execution_term_days"],
          message: `El plazo no coincide con las fechas (${computed} días calendario entre inicio y término).`,
        });
      }
    }
  });

const metradoSchema = z.object({
  project_id: z.string().uuid(),
  item_id: z.string().uuid(),
  entry_date: z.string().min(1),
  period_month: z.string().min(1),
  quantity: z.coerce.number().positive(),
  notes: z.string().trim().max(500).optional(),
});

const memoriaSchema = z.object({
  project_id: z.string().uuid(),
  period_month: z.string().min(1),
  title: z.string().trim().min(3).max(180),
  executive_summary: z.string().trim().max(800).optional(),
});

const valuationSchema = z.object({
  project_id: z.string().uuid(),
  period_month: z.string().min(1),
  deductions_amount: z.coerce.number().min(0),
  progress_percent: z.coerce.number().min(0).max(100).optional(),
});

const liquidationSchema = z.object({
  project_id: z.string().uuid(),
  summary_text: z.string().trim().max(1200).optional(),
  total_deductions_amount: z.coerce.number().min(0),
});

const settingsSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  job_title: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  signature_url: z.string().trim().url().optional().or(z.literal("")),
});

function SectionTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="w-full max-w-full overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header} className="whitespace-nowrap">{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {row.map((cell, cellIndex) => (
                <TableCell key={cellIndex} className="align-top">{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ScrollableImportTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="w-full max-w-full overflow-hidden rounded-lg border border-border bg-card">
      <div className="max-h-[480px] w-full max-w-full overflow-x-auto overflow-y-auto">
        <table className="min-w-full caption-bottom text-sm">
          <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr className="border-b border-border">
              {headers.map((header) => (
                <th key={header} className="h-10 whitespace-nowrap px-3 text-left align-middle font-medium text-muted-foreground">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length} className="p-4 text-center text-muted-foreground">Sin filas detectadas.</td></tr>
            ) : rows.map((row, index) => (
              <tr key={index} className="border-b border-border/60 hover:bg-muted/40">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="p-3 align-top">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type BudgetHierarchyItem = {
  item_code?: string | null;
  description: string;
  unit: string;
  base_quantity: number;
  unit_price: number;
  partial_amount: number;
  hierarchy_level?: number | null;
  sort_order?: number | null;
};

function compareBudgetItemCodes(a: string | null | undefined, b: string | null | undefined): number {
  const codeA = (a ?? "").trim();
  const codeB = (b ?? "").trim();
  if (!codeA && !codeB) return 0;
  if (!codeA) return 1;
  if (!codeB) return -1;

  const partsA = codeA.split(".");
  const partsB = codeB.split(".");
  const length = Math.max(partsA.length, partsB.length);

  for (let index = 0; index < length; index += 1) {
    const partA = partsA[index];
    const partB = partsB[index];
    if (partA == null) return -1;
    if (partB == null) return 1;

    const numA = Number(partA);
    const numB = Number(partB);
    if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) return numA - numB;
    if (partA !== partB) return partA.localeCompare(partB, "es", { numeric: true, sensitivity: "base" });
  }

  return 0;
}

function sortBudgetItemsHierarchically<T extends BudgetHierarchyItem>(items: T[]): T[] {
  return items.slice().sort((a, b) => {
    const codeOrder = compareBudgetItemCodes(a.item_code, b.item_code);
    if (codeOrder !== 0) return codeOrder;
    return Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
  });
}

function getBudgetHierarchyStats<T extends BudgetHierarchyItem>(items: T[]) {
  const parentSet = buildParentCodeSet(items.map((item) => ({ item_code: item.item_code ?? null })));
  const leafItems = items.filter((item) => isLeafByCode(item.item_code, parentSet));
  const leafSubtotal = leafItems.reduce((sum, item) => sum + Number(item.partial_amount || 0), 0);
  return { parentSet, leafItems, leafSubtotal, nodeCount: items.length, leafCount: leafItems.length };
}

function renderBudgetDescription(item: BudgetHierarchyItem) {
  const level = item.hierarchy_level ?? Math.max((item.item_code ?? "").split(".").filter(Boolean).length - 1, 0);
  return (
    <span className="block" style={{ paddingInlineStart: `${Math.min(level, 6) * 1.25}rem` }}>
      {item.description || "—"}
    </span>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn, signUp, isAuthenticated, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", fullName: "" });

  const getAuthErrorMessage = (submitError: unknown) => {
    const message = submitError instanceof Error ? submitError.message : "";

    if (message.includes("Email not confirmed") || message.includes("email_not_confirmed")) {
      return "Tu cuenta existe, pero primero debes confirmar el correo desde el enlace enviado a tu bandeja de entrada.";
    }

    if (message.includes("Invalid login credentials") || message.includes("invalid_credentials")) {
      return "Correo o contraseña incorrectos. Si acabas de registrarte varias veces con el mismo correo, usa la contraseña del primer registro confirmado por el sistema.";
    }

    if (message.includes("weak_password")) {
      return "La contraseña es demasiado débil. Usa una más segura y difícil de adivinar.";
    }

    return submitError instanceof Error ? submitError.message : "No se pudo completar la operación.";
  };

  if (!loading && isAuthenticated) {
    void navigate({ to: "/app/dashboard" });
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        await signIn(form.email, form.password);
        void navigate({ to: "/app/dashboard" });
      } else {
        await signUp({ email: form.email, password: form.password, fullName: form.fullName });
        setMode("signin");
        setNotice("Cuenta creada. Revisa tu correo y confirma tu acceso antes de iniciar sesión.");
      }
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background">
      {/* Top-right controls */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-foreground backdrop-blur hover:bg-accent"
        >
          ← Volver a inicio
        </Link>
        <LoginThemeToggle />
      </div>
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-[28rem] w-[28rem] rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,hsl(var(--primary)/0.08),transparent_60%)]" />
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10 sm:px-10 lg:px-16 lg:py-16">
        <div className="grid flex-1 items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Left: brand & value props */}
          <section className="space-y-8">
            <div className="space-y-5">
              <Badge variant="outline" className="px-3 py-1 text-xs tracking-wide">
                Sistema web · Ingeniería civil
              </Badge>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
                Gestión integral de metrados, valorizaciones y liquidación de obras.
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
                Plataforma operativa de <span className="font-medium text-foreground">JJ&amp;PP Ingenieros</span> para registrar metrados ejecutados, controlar memorias valorizadas, calcular valorizaciones mensuales y consolidar la liquidación final con trazabilidad completa.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Control mensual", "Metrados, memoria y valorización enlazados por periodo."],
                ["Trazabilidad", "Bitácora auditable de cambios y aprobaciones."],
                ["Documentos", "Exportación a PDF y Excel desde el flujo operativo."],
              ].map(([title, text]) => (
                <div key={title} className="rounded-lg border border-border/60 bg-card/50 p-4 backdrop-blur-sm">
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Right: auth card */}
          <div className="flex justify-center lg:justify-end">
            <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-xl backdrop-blur">
              <CardHeader className="space-y-2 px-8 pt-8">
                <CardTitle className="text-2xl">
                  {mode === "signin" ? "Ingresar al sistema" : "Crear acceso inicial"}
                </CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {mode === "signin"
                    ? "Usa tu correo corporativo para acceder al panel operativo."
                    : "El primer usuario registrado recibirá el rol administrador automáticamente."}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-8 pb-8">
                <form className="space-y-5" onSubmit={submit}>
                  {mode === "signup" ? (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Nombre completo</label>
                      <Input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} required />
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Correo</label>
                    <Input type="email" autoComplete="email" placeholder="tu.correo@empresa.com" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Contraseña</label>
                    <Input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder="••••••••" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required />
                  </div>
                  {notice ? <p className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">{notice}</p> : null}
                  {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
                  <Button className="w-full" type="submit" disabled={busy}>
                    {busy ? "Procesando…" : mode === "signin" ? "Ingresar" : "Crear cuenta"}
                  </Button>
                  <div className="relative py-1">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border/60" /></div>
                    <div className="relative flex justify-center"><span className="bg-card px-3 text-xs uppercase tracking-wider text-muted-foreground">o</span></div>
                  </div>
                  <Button className="w-full" type="button" variant="outline" onClick={() => {
                    setError(null);
                    setNotice(null);
                    setMode((current) => (current === "signin" ? "signup" : "signin"));
                  }}>
                    {mode === "signin" ? "Registrar primer acceso" : "Ya tengo cuenta"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
        <p className="mt-10 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} JJ&amp;PP Ingenieros · Plataforma de gestión de obras
        </p>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { projects, valuations, memorias, auditLogs, loading } = useWorkspace();

  const metrics = useMemo(() => buildDashboardMetrics(projects, valuations, memorias), [projects, valuations, memorias]);
  const auditSummary = useMemo(() => buildAuditSummary(auditLogs), [auditLogs]);

  if (loading) return <AuthGuard><div className="text-sm text-muted-foreground">Cargando dashboard…</div></AuthGuard>;

  return (
    <AuthGuard>
      <PageLayout title="Dashboard" description="Visión ejecutiva del ciclo mensual de obra, desde metrados hasta valorizaciones aprobadas.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <Card key={metric.label}>
              <CardHeader>
                <CardDescription>{metric.label}</CardDescription>
                <CardTitle className="text-2xl">{metric.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{metric.hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>Estado de proyectos</CardTitle>
              <CardDescription>Seguimiento de avance, contrato y estado del flujo técnico-financiero.</CardDescription>
            </CardHeader>
            <CardContent>
              <SectionTable
                headers={["Código", "Proyecto", "Contrato", "Estado", "Avance"]}
                rows={projects.slice(0, 8).map((project) => [
                  project.code,
                  project.name,
                  contractTypeLabels[project.contract_type],
                  <Badge key={project.id} variant="outline">{projectStatusLabels[project.status]}</Badge>,
                  `${formatNumber(calculateProjectProgress(project, valuations))}%`,
                ])}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trazabilidad reciente</CardTitle>
              <CardDescription>Eventos registrados por el sistema y los responsables.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {auditSummary.length ? auditSummary.map((item) => (
                <div key={`${item.entity}-${item.timestamp}`} className="rounded-md border border-border p-3">
                  <p className="text-sm font-medium text-foreground">{item.entity}</p>
                  <p className="text-sm text-muted-foreground">{item.action} · {item.actor}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.timestamp}</p>
                </div>
              )) : <p className="text-sm text-muted-foreground">Aún no hay actividad registrada.</p>}
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </AuthGuard>
  );
}

// ProjectRow type extracted for the edit dialog
type EditableProject = ReturnType<typeof useWorkspace>["projects"][number];

export function isFichaTecnicaIncomplete(project: EditableProject | undefined | null): boolean {
  if (!project) return true;
  const required = [
    project.entity_name,
    project.contractor_name,
    project.supervisor_name,
    project.resident_name,
    project.execution_modality,
    project.location,
    project.execution_contract,
    project.supervision_contract,
    project.start_date,
    project.planned_end_date,
  ];
  if (required.some((v) => !v || String(v).trim() === "")) return true;
  if (!project.contract_amount || Number(project.contract_amount) <= 0) return true;
  if (!project.execution_term_days || Number(project.execution_term_days) <= 0) return true;
  return false;
}

type ProjectMovementCheck = {
  budget_imports: number;
  budget_items: number;
  metrado_entries: number;
  metrado_lines: number;
  memoria_valorizada: number;
  valuations: number;
  valuation_periods: number;
  liquidations: number;
  expediente_documents: number;
};

async function checkProjectMovement(projectId: string): Promise<ProjectMovementCheck> {
  const tables = [
    "budget_imports",
    "budget_items",
    "metrado_entries",
    "metrado_lines",
    "memoria_valorizada",
    "valuations",
    "valuation_periods",
    "liquidations",
    "expediente_documents",
  ] as const;
  const result: Record<string, number> = {};
  await Promise.all(
    tables.map(async (table) => {
      const { count } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      result[table] = count ?? 0;
    }),
  );
  return result as ProjectMovementCheck;
}

const movementLabels: Record<keyof ProjectMovementCheck, string> = {
  budget_imports: "Importaciones de presupuesto",
  budget_items: "Partidas de presupuesto",
  metrado_entries: "Metrados (asientos)",
  metrado_lines: "Líneas de metrado detallado",
  memoria_valorizada: "Memorias valorizadas",
  valuations: "Valorizaciones",
  valuation_periods: "Períodos de valorización",
  liquidations: "Liquidaciones",
  expediente_documents: "Documentos del expediente",
};

function DeleteOrArchiveProjectDialog({
  project,
  onDone,
}: {
  project: EditableProject;
  onDone: (result?: { removed?: boolean }) => Promise<void> | void;
}) {
  const { isAdmin, session } = useAuth();
  const purgeProjectFn = useServerFn(purgeProject);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [movement, setMovement] = useState<ProjectMovementCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [purgeMode, setPurgeMode] = useState(false);
  const [purgeAck, setPurgeAck] = useState(false);
  const [purgeCode, setPurgeCode] = useState("");

  const showError = (message: string) => {
    setError(message);
    toast.error(message, { duration: 10000 });
  };

  useEffect(() => {
    if (!open) {
      setPurgeMode(false);
      setPurgeAck(false);
      setPurgeCode("");
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void checkProjectMovement(project.id)
      .then(setMovement)
      .catch((e) => setError(e?.message ?? "No se pudo verificar el proyecto."))
      .finally(() => setLoading(false));
  }, [open, project.id]);

  const totalMovement = movement
    ? Object.values(movement).reduce((sum, n) => sum + n, 0)
    : 0;
  const isEmpty = movement !== null && totalMovement === 0;

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar permanentemente el proyecto "${project.name}"? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    setError(null);
    const { error: delError } = await supabase.from("projects").delete().eq("id", project.id);
    setBusy(false);
    if (delError) {
      showError(delError.message);
      return;
    }
    toast.success("Proyecto eliminado permanentemente.");
    setOpen(false);
    await onDone({ removed: true });
  };

  const handleStatusChange = async (newStatus: "archived" | "cancelled") => {
    const verb = newStatus === "archived" ? "archivar" : "cancelar";
    if (!confirm(`¿Confirmas ${verb} el proyecto "${project.name}"? Se conservará el historial.`)) return;
    setBusy(true);
    setError(null);
    const { error: updError } = await supabase
      .from("projects")
      .update({ status: newStatus })
      .eq("id", project.id);
    setBusy(false);
    if (updError) {
      showError(updError.message);
      return;
    }
    toast.success(newStatus === "archived" ? "Proyecto archivado." : "Proyecto cancelado.");
    setOpen(false);
    await onDone();
  };

  const handlePurge = async () => {
    if (!confirm(
      `ADVERTENCIA FINAL\n\nVas a PURGAR permanentemente "${project.code} · ${project.name}" y TODA su información asociada (presupuesto, metrados, memoria, valorizaciones, deducciones, documentos…). Esta acción NO se puede deshacer.\n\n¿Continuar?`,
    )) return;
    setBusy(true);
    setError(null);
    const tid = toast.loading("Purgando proyecto y eliminando información relacionada…");
    try {
      if (!session?.access_token) {
        throw new Error("No hay una sesión válida para ejecutar la purga. Vuelve a iniciar sesión e inténtalo nuevamente.");
      }
      const result = await purgeProjectFn({
        data: { projectId: project.id, confirmCode: purgeCode },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!result?.success) {
        throw new Error("La purga no confirmó una eliminación completa.");
      }
      const { data: stillExists, error: verifyError } = await supabase
        .from("projects")
        .select("id")
        .eq("id", project.id)
        .maybeSingle();
      if (verifyError) throw new Error(`La purga terminó, pero no se pudo refrescar/verificar la lista: ${verifyError.message}`);
      if (stillExists) throw new Error("La purga terminó, pero el proyecto todavía aparece en la base de datos.");
      toast.success("Proyecto purgado completamente. Ya no existe en el sistema.");
      setOpen(false);
      await onDone({ removed: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al purgar el proyecto.";
      showError(msg);
    } finally {
      toast.dismiss(tid);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
          Eliminar / Archivar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{purgeMode ? "Purgar proyecto" : "Eliminar o archivar proyecto"}</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{project.code} · {project.name}</span>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Verificando información asociada…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : movement ? (
          <div className="space-y-4">
            {purgeMode ? (
              <div className="space-y-3">
                <div className="rounded-md border border-destructive/60 bg-destructive/10 p-3 text-sm">
                  <p className="font-semibold text-destructive">⚠ Acción irreversible</p>
                  <p className="mt-1">
                    Se eliminarán <span className="font-medium">el proyecto y TODOS sus registros relacionados</span>:
                    ficha técnica, presupuesto, partidas, metrados, memoria valorizada, valorizaciones,
                    deducciones, documentos y archivos. El sistema quedará como si el proyecto nunca hubiera existido.
                  </p>
                </div>
                {totalMovement > 0 ? (
                  <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
                    {(Object.keys(movement) as Array<keyof ProjectMovementCheck>)
                      .filter((k) => movement[k] > 0)
                      .map((k) => (
                        <li key={k}>
                          {movementLabels[k]}: <span className="font-medium text-foreground">{movement[k]}</span>
                        </li>
                      ))}
                  </ul>
                ) : null}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={purgeAck}
                    onChange={(e) => setPurgeAck(e.target.checked)}
                    className="mt-1"
                  />
                  <span>Entiendo que esta acción es <span className="font-medium">permanente e irreversible</span>.</span>
                </label>
                <div>
                  <label className="text-sm">
                    Para confirmar, escribe el código del proyecto:{" "}
                    <span className="font-mono font-medium text-foreground">{project.code}</span>
                  </label>
                  <Input
                    className="mt-1"
                    value={purgeCode}
                    onChange={(e) => setPurgeCode(e.target.value)}
                    placeholder={project.code}
                    autoComplete="off"
                  />
                </div>
              </div>
            ) : isEmpty ? (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                Este proyecto <span className="font-medium text-foreground">no tiene información asociada</span>.
                Puedes eliminarlo permanentemente.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  Este proyecto tiene información registrada y <span className="font-medium">no puede eliminarse físicamente</span> con la acción estándar.
                  Puedes archivarlo, cancelarlo o {isAdmin ? "purgarlo (admin)" : "solicitar a un administrador la purga total"}.
                </div>
                <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
                  {(Object.keys(movement) as Array<keyof ProjectMovementCheck>)
                    .filter((k) => movement[k] > 0)
                    .map((k) => (
                      <li key={k}>
                        {movementLabels[k]}: <span className="font-medium text-foreground">{movement[k]}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          {purgeMode ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setPurgeMode(false)} disabled={busy}>
                Volver
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handlePurge}
                disabled={
                  busy ||
                  !purgeAck ||
                  purgeCode.trim().toUpperCase() !== project.code.trim().toUpperCase()
                }
              >
                {busy ? "Purgando…" : "Purgar definitivamente"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cerrar
              </Button>
              {isEmpty ? (
                <Button type="button" variant="destructive" onClick={handleDelete} disabled={busy}>
                  {busy ? "Eliminando…" : "Eliminar permanentemente"}
                </Button>
              ) : movement ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleStatusChange("archived")}
                    disabled={busy || project.status === "archived"}
                  >
                    Archivar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleStatusChange("cancelled")}
                    disabled={busy || project.status === "cancelled"}
                  >
                    Cancelar proyecto
                  </Button>
                  {isAdmin ? (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => setPurgeMode(true)}
                      disabled={busy}
                    >
                      Purgar (admin)
                    </Button>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

  );
}

export function EditProjectDialog({
  project,
  onSaved,
  triggerLabel,
  triggerVariant,
}: {
  project: EditableProject;
  onSaved: () => Promise<void> | void;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof fichaTecnicaSchema>>({
    resolver: zodResolver(fichaTecnicaSchema),
    defaultValues: {
      entity_name: project.entity_name ?? "",
      contractor_name: project.contractor_name ?? "",
      supervisor_name: project.supervisor_name ?? "",
      resident_name: project.resident_name ?? "",
      execution_modality: project.execution_modality ?? "",
      location: project.location ?? "",
      execution_contract: project.execution_contract ?? "",
      supervision_contract: project.supervision_contract ?? "",
      contract_amount: Number(project.contract_amount ?? 0),
      start_date: project.start_date ?? "",
      execution_term_days: project.execution_term_days ?? 0,
      planned_end_date: project.planned_end_date ?? "",
      status: project.status,
    },
  });

  // Sync execution_term_days <-> start_date / planned_end_date
  const startDate = form.watch("start_date");
  const endDate = form.watch("planned_end_date");
  const termDays = form.watch("execution_term_days");
  const lastEditedRef = useRef<"dates" | "term" | null>(null);

  useEffect(() => {
    if (lastEditedRef.current === "term") return;
    if (!startDate || !endDate) return;
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return;
    const computed = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
    if (computed !== Number(termDays || 0)) {
      form.setValue("execution_term_days", computed, { shouldValidate: true, shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  useEffect(() => {
    if (lastEditedRef.current !== "term") return;
    if (!startDate || !termDays || Number(termDays) <= 0) return;
    const s = new Date(startDate);
    if (Number.isNaN(s.getTime())) return;
    const e = new Date(s.getTime() + (Number(termDays) - 1) * 86_400_000);
    const iso = e.toISOString().slice(0, 10);
    if (iso !== endDate) {
      form.setValue("planned_end_date", iso, { shouldValidate: true, shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termDays, startDate]);

  const submit = form.handleSubmit(async (values) => {
    const payload = {
      entity_name: values.entity_name || null,
      contractor_name: values.contractor_name || null,
      supervisor_name: values.supervisor_name || null,
      resident_name: values.resident_name || null,
      execution_modality: values.execution_modality || null,
      location: values.location || null,
      execution_contract: values.execution_contract || null,
      supervision_contract: values.supervision_contract || null,
      contract_amount: values.contract_amount,
      start_date: values.start_date || null,
      execution_term_days: values.execution_term_days || null,
      planned_end_date: values.planned_end_date || null,
      status: values.status,
    };
    const { error } = await supabase.from("projects").update(payload).eq("id", project.id);
    if (error) {
      form.setError("root", { message: error.message });
      return;
    }
    toast.success("Ficha técnica actualizada");
    setOpen(false);
    await onSaved();
  });

  const incomplete = isFichaTecnicaIncomplete(project);
  const label = triggerLabel ?? (incomplete ? "Completar ficha técnica" : "Editar ficha técnica");
  const variant = triggerVariant ?? (incomplete ? "default" : "outline");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>{label}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ficha técnica del proyecto</DialogTitle>
          <DialogDescription>
            Información obligatoria que aparecerá en el Expediente Mensual de Supervisión/Valorización.
            Los cambios se sincronizan entre Proyectos y Memoria valorizada e Informe Técnico.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField control={form.control} name="entity_name" render={({ field }) => (
                <FormItem><FormLabel>Entidad *</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="Municipalidad / Entidad contratante" /></FormControl><FormMessage /></FormItem>
              )} />
              <CipLookupField
                control={form.control}
                name="contractor_name"
                label="Contratista *"
                placeholder="Razón social o responsable técnico"
                onResolved={(name) => form.setValue("contractor_name", name, { shouldDirty: true, shouldValidate: true })}
              />
              <CipLookupField
                control={form.control}
                name="supervisor_name"
                label="Supervisor *"
                placeholder="Apellidos y nombres del supervisor"
                onResolved={(name) => form.setValue("supervisor_name", name, { shouldDirty: true, shouldValidate: true })}
              />
              <CipLookupField
                control={form.control}
                name="resident_name"
                label="Residente *"
                placeholder="Apellidos y nombres del residente"
                onResolved={(name) => form.setValue("resident_name", name, { shouldDirty: true, shouldValidate: true })}
              />
              <FormField control={form.control} name="execution_modality" render={({ field }) => (
                <FormItem><FormLabel>Modalidad de ejecución *</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="Contrata / Administración directa" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem><FormLabel>Ubicación *</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="Distrito, provincia, región" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="execution_contract" render={({ field }) => (
                <FormItem><FormLabel>Contrato de ejecución *</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="N° de contrato" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="supervision_contract" render={({ field }) => (
                <FormItem><FormLabel>Contrato de supervisión *</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="N° de contrato" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="contract_amount" render={({ field }) => (
                <FormItem><FormLabel>Monto contractual *</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="start_date" render={({ field }) => (
                <FormItem><FormLabel>Fecha de inicio *</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ""} onChange={(e) => { lastEditedRef.current = "dates"; field.onChange(e); }} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="execution_term_days" render={({ field }) => (
                <FormItem>
                  <FormLabel>Plazo de ejecución (días) *</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} {...field} value={field.value ?? 0} onChange={(e) => { lastEditedRef.current = "term"; field.onChange(e); }} />
                  </FormControl>
                  <FormDescription>Se calcula automáticamente desde las fechas de inicio y término (días calendario, inclusivos).</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="planned_end_date" render={({ field }) => (
                <FormItem><FormLabel>Fecha de término *</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ""} onChange={(e) => { lastEditedRef.current = "dates"; field.onChange(e); }} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem><FormLabel>Estado del proyecto *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(projectStatusLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
            </div>
            {form.formState.errors.root ? <p className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Guardando…" : "Guardar ficha técnica"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Campo de texto + búsqueda por CIP.
 * El usuario escribe el CIP en un input pequeño, presiona "Buscar" y, si se encuentra,
 * se autocompleta el nombre. Si la consulta falla, puede escribir el nombre manualmente.
 */
function CipLookupField({
  control,
  name,
  label,
  placeholder,
  onResolved,
}: {
  control: ReturnType<typeof useForm<z.infer<typeof fichaTecnicaSchema>>>["control"];
  name: "contractor_name" | "supervisor_name" | "resident_name";
  label: string;
  placeholder?: string;
  onResolved: (name: string) => void;
}) {
  const [cip, setCip] = useState("");
  const [loading, setLoading] = useState(false);
  const lookupFn = useServerFn(cipLookup);

  const handleLookup = async () => {
    const trimmed = cip.trim();
    if (!/^\d{4,8}$/.test(trimmed)) {
      toast.error("Ingresa un CIP válido (4 a 8 dígitos numéricos).");
      return;
    }
    setLoading(true);
    try {
      const res = await lookupFn({ data: { cip: trimmed } });
      if (res.found && res.fullName) {
        onResolved(res.fullName);
        toast.success(`CIP ${trimmed}: ${res.fullName}`);
      } else {
        toast.warning(res.error ?? "No se encontró el colegiado. Completa el nombre manualmente.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al consultar el CIP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex gap-1">
            <Input
              type="text"
              inputMode="numeric"
              value={cip}
              onChange={(e) => setCip(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="CIP"
              className="w-24"
              aria-label={`CIP de ${label}`}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleLookup}
              disabled={loading || !cip}
              aria-label="Buscar en CIP"
              title="Buscar en cipvirtual.cip.org.pe"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
            </Button>
          </div>
          <FormControl>
            <Input {...field} value={field.value ?? ""} placeholder={placeholder} />
          </FormControl>
          <FormDescription className="text-[11px]">
            Ingresa el CIP y presiona buscar para autocompletar el nombre, o escríbelo manualmente.
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * Panel reutilizable de Ficha técnica:
 * - Muestra los datos en modo lectura (grid).
 * - Incluye botón para abrir el modal de edición (EditProjectDialog).
 * - Se puede usar en Proyectos, Memoria valorizada e Informe Técnico.
 */
export function FichaTecnicaPanel({
  project,
  onSaved,
  showAlertWhenIncomplete = true,
}: {
  project: EditableProject;
  onSaved: () => Promise<void> | void;
  showAlertWhenIncomplete?: boolean;
}) {
  const incomplete = isFichaTecnicaIncomplete(project);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <FichaDatoCell label="Entidad" value={project.entity_name} />
        <FichaDatoCell label="Contratista" value={project.contractor_name} />
        <FichaDatoCell label="Supervisor" value={project.supervisor_name} />
        <FichaDatoCell label="Residente" value={project.resident_name} />
        <FichaDatoCell label="Modalidad de ejecución" value={project.execution_modality} />
        <FichaDatoCell label="Ubicación" value={project.location} />
        <FichaDatoCell label="Contrato de ejecución" value={project.execution_contract} />
        <FichaDatoCell label="Contrato de supervisión" value={project.supervision_contract} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {incomplete && showAlertWhenIncomplete ? (
          <p className="text-xs text-destructive">
            La ficha técnica está incompleta. Completa los datos antes de generar el PDF.
          </p>
        ) : <span />}
        <EditProjectDialog project={project} onSaved={onSaved} />
      </div>
    </div>
  );
}

function FichaDatoCell({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{String(value || "—")}</p>
    </div>
  );
}

export function ProjectsPage() {
  const { projects, refresh } = useWorkspace();
  const { user, roles } = useAuth();
  const [open, setOpen] = useState(false);
  const [purgedProjectIds, setPurgedProjectIds] = useState<Set<string>>(() => new Set());
  const visibleProjects = useMemo(
    () => projects.filter((project) => !purgedProjectIds.has(project.id)),
    [projects, purgedProjectIds],
  );

  const refreshProjectsAfterRemoval = async (projectId: string) => {
    setPurgedProjectIds((current) => new Set(current).add(projectId));
    await refresh();
  };
  const form = useForm<z.infer<typeof projectSchema>>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      code: "",
      name: "",
      client_name: "",
      location: "",
      contract_type: "precios_unitarios",
      contract_amount: 0,
      status: "draft",
      start_date: "",
    },
  });

  // Temporal: cualquier usuario autenticado puede crear proyectos.
  // El control fino por rol (Residente) se reactivará luego.
  const canCreate = Boolean(user);

  const createProject = form.handleSubmit(async (values) => {
    if (!user) return;
    const payload = {
      code: values.code,
      name: values.name,
      client_name: values.client_name || null,
      location: values.location || null,
      contract_type: values.contract_type,
      contract_amount: values.contract_amount,
      status: values.status,
      created_by: user.id,
      progress_percent: 0,
      start_date: values.start_date || null,
    };

    const { data, error } = await supabase.from("projects").insert(payload).select("*").single();
    if (error) {
      form.setError("root", { message: error.message });
      return;
    }

    await supabase.from("project_members").insert({
      project_id: data.id,
      user_id: user.id,
      role: roles.includes("admin") ? "admin" : "resident",
    });
    form.reset({
      code: "",
      name: "",
      client_name: "",
      location: "",
      contract_type: "precios_unitarios",
      contract_amount: 0,
      status: "draft",
      start_date: "",
    });
    setOpen(false);
    await refresh();
  });

  const newProjectDialog = canCreate ? (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Nuevo proyecto</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear proyecto</DialogTitle>
          <DialogDescription>Define el contrato correctamente; no podrá cambiarse tras iniciar la obra.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={createProject}>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem><FormLabel>Código *</FormLabel><FormControl><Input {...field} placeholder="P-2026-001" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem><FormLabel>Estado *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(projectStatusLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Nombre *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid gap-4 md:grid-cols-2">
              <FormField control={form.control} name="client_name" render={({ field }) => (
                <FormItem><FormLabel>Cliente</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem><FormLabel>Ubicación *</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="Distrito, provincia, región" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField control={form.control} name="contract_type" render={({ field }) => (
                <FormItem><FormLabel>Tipo de contrato *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Selecciona el tipo" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="precios_unitarios">Precios unitarios</SelectItem>
                      <SelectItem value="suma_alzada">Suma alzada</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>Obligatorio. No podrá modificarse luego del inicio.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="contract_amount" render={({ field }) => (
                <FormItem><FormLabel>Monto contractual</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="start_date" render={({ field }) => (
              <FormItem><FormLabel>Fecha de inicio</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
            )} />
            {form.formState.errors.root ? <p className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Guardando…" : "Guardar proyecto"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  ) : null;

  return (
    <AuthGuard>
      <PageLayout
        title="Proyectos"
        description="Registro maestro de obras, tipo de contrato, cliente y estado contractual."
        actions={newProjectDialog}
      >
        {!canCreate ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">No puedes crear proyectos</CardTitle>
              <CardDescription>
                Solo los usuarios con rol <strong>Residente de obra</strong> o <strong>Administrador</strong> pueden registrar nuevos proyectos. Pide al administrador que te asigne el rol "Residente de obra" desde Usuarios y roles.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
        {visibleProjects.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aún no hay proyectos registrados</CardTitle>
              <CardDescription>
                {canCreate ? "Usa el botón \"Nuevo proyecto\" para registrar la primera obra." : "Cuando el residente registre proyectos, aparecerán aquí."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <SectionTable
            headers={["Código", "Proyecto", "Cliente", "Ubicación", "Contrato", "Monto", "Estado", "Ficha técnica", "Acciones"]}
            rows={visibleProjects.map((project) => {
              const incomplete = isFichaTecnicaIncomplete(project);
              return [
                project.code,
                project.name,
                project.client_name || "—",
                project.location || "—",
                contractTypeLabels[project.contract_type],
                formatCurrency(Number(project.contract_amount), project.currency_code),
                <Badge key={`s-${project.id}`} variant="outline">{projectStatusLabels[project.status]}</Badge>,
                <Badge key={`f-${project.id}`} variant={incomplete ? "destructive" : "secondary"}>
                  {incomplete ? "Incompleta" : "Completa"}
                </Badge>,
                <div key={`a-${project.id}`} className="flex flex-wrap gap-2">
                  <EditProjectDialog project={project} onSaved={refresh} />
                  <DeleteOrArchiveProjectDialog
                    project={project}
                    onDone={(result) => result?.removed ? refreshProjectsAfterRemoval(project.id) : refresh()}
                  />
                </div>,
              ];
            })}
          />
        )}
      </PageLayout>
    </AuthGuard>
  );
}

export function BudgetsPage() {
  const { projects, budgetItems, refresh } = useWorkspace();
  const { user } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof detectBudgetWorkbook>> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const uploadBudget = async () => {
    if (!file || !selectedProjectId || !user || !preview) return;
    const storagePath = `${selectedProjectId}/${Date.now()}-${file.name}`;
    const storage = await supabase.storage.from("budget-imports").upload(storagePath, file, { upsert: true });
    if (storage.error) return setMessage(storage.error.message);

    const importResult = await supabase
      .from("budget_imports")
      .insert({
        project_id: selectedProjectId,
        uploaded_by: user.id,
        file_name: file.name,
        file_path: storagePath,
        status: "imported",
        column_mapping: preview.mapping,
        validation_summary: { warnings: preview.warnings, importedRows: preview.rows.length },
        imported_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (importResult.error) return setMessage(importResult.error.message);

    const itemsPayload = preview.rows.map((row, index) => ({
      project_id: selectedProjectId,
      budget_import_id: importResult.data.id,
      item_code: row.item_code || null,
      description: row.description,
      unit: row.unit,
      base_quantity: row.base_quantity,
      unit_price: row.unit_price,
      partial_amount: row.partial_amount,
      hierarchy_level: row.hierarchy_level ?? null,
      parent_item_code: row.parent_item_code ?? null,
      category: row.category || null,
      sort_order: index + 1,
    }));

    const insertItems = await supabase.from("budget_items").insert(itemsPayload);
    if (insertItems.error) return setMessage(insertItems.error.message);
    setMessage(`Importación completada con ${preview.rows.length} partidas.`);
    setPreview(null);
    setFile(null);
    await refresh();
  };

  const currentItems = budgetItems.filter((item) => item.project_id === selectedProjectId);

  return (
    <AuthGuard>
      <PageLayout title="Importación de presupuesto" description="Carga flexible de Excel para crear partidas base por proyecto.">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Cargar Excel</CardTitle>
              <CardDescription>Se detectan columnas como código, descripción, unidad, metrado y precio unitario.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger><SelectValue placeholder="Selecciona proyecto" /></SelectTrigger>
                <SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.code} · {project.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="file" accept=".xlsx,.xls" onChange={async (event) => {
                const selected = event.target.files?.[0];
                if (!selected) return;
                setFile(selected);
                const detected = await detectBudgetWorkbook(selected);
                setPreview(detected);
              }} />
              {preview ? (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                  <p className="font-medium text-foreground">Se detectaron {preview.rows.length} partidas en el archivo.</p>
                  {preview.warnings.length ? <p className="mt-1 text-xs text-muted-foreground">{preview.warnings.join(" ")}</p> : <p className="mt-1 text-xs text-muted-foreground">Revisa la vista previa completa antes de confirmar la importación.</p>}
                </div>
              ) : null}
              {message ? <p className="text-sm text-primary">{message}</p> : null}
              <Button onClick={() => void uploadBudget()} disabled={!preview || !selectedProjectId}>Importar presupuesto</Button>
            </CardContent>
          </Card>
          {preview ? (() => {
            const sortedPreviewRows = sortBudgetItemsHierarchically(preview.rows);
            const previewStats = getBudgetHierarchyStats(preview.rows);
            const grandTotal = previewStats.leafSubtotal;
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Vista previa de importación</CardTitle>
                  <CardDescription>
                    Revisa todas las partidas detectadas y el subtotal general antes de confirmar la importación.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-border bg-muted/40 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Ítems hoja ejecutables</p>
                      <p className="text-2xl font-semibold text-foreground">{previewStats.leafCount}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{previewStats.nodeCount} nodos jerárquicos importados</p>
                    </div>
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Subtotal general del presupuesto</p>
                      <p className="text-2xl font-semibold text-primary">{formatCurrency(grandTotal)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Calculado solo con nodos hoja</p>
                    </div>
                  </div>
                  <ScrollableImportTable
                    headers={["Ítem", "Descripción", "Tipo", "Unidad", "Metrado", "Precio unitario", "Parcial"]}
                    rows={[
                      ...sortedPreviewRows.map((item) => {
                        const isLeaf = isLeafByCode(item.item_code, previewStats.parentSet);
                        return [
                        item.item_code || "—",
                        renderBudgetDescription(item),
                        isLeaf ? "Ejecutable" : "Agrupador",
                        isLeaf ? item.unit : "",
                        isLeaf ? formatNumber(Number(item.base_quantity), 4) : "",
                        isLeaf ? formatCurrency(Number(item.unit_price)) : "",
                        isLeaf ? formatCurrency(Number(item.partial_amount)) : "",
                      ];
                    }),
                      [
                        "",
                        <span className="font-semibold text-foreground">Subtotal general</span>,
                        <span className="font-semibold text-foreground">Solo hojas</span>,
                        "",
                        "",
                        "",
                        <span className="font-semibold text-primary">{formatCurrency(grandTotal)}</span>,
                      ],
                    ]}
                  />
                  <p className="text-xs text-muted-foreground">
                    {previewStats.nodeCount} nodos mostrados · {previewStats.leafCount} ítems hoja · subtotal general sin doble conteo.
                  </p>
                </CardContent>
              </Card>
            );
          })() : null}
          {(() => {
            const sortedCurrentItems = sortBudgetItemsHierarchically(currentItems);
            const registeredStats = getBudgetHierarchyStats(currentItems);
            const registeredTotal = registeredStats.leafSubtotal;
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Partidas registradas</CardTitle>
                  <CardDescription>
                    Listado completo de partidas cargadas para el proyecto seleccionado. Use el scroll interno para revisarlas todas.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Ítems hoja ejecutables</p>
                      <p className="mt-1 text-2xl font-semibold text-foreground">{registeredStats.leafCount} partidas finales</p>
                      <p className="mt-1 text-xs text-muted-foreground">{registeredStats.nodeCount} nodos jerárquicos registrados</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Subtotal general del presupuesto</p>
                      <p className="mt-1 text-2xl font-semibold text-foreground">{formatCurrency(registeredTotal)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Suma exclusiva de ítems hoja</p>
                    </div>
                  </div>
                  {currentItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay partidas registradas para este proyecto todavía.</p>
                  ) : (
                    <ScrollableImportTable
                      headers={["Ítem", "Descripción", "Tipo", "Unidad", "Metrado", "Precio unitario", "Parcial"]}
                      rows={[
                        ...sortedCurrentItems.map((item) => {
                          const isLeaf = isLeafByCode(item.item_code, registeredStats.parentSet);
                          return [
                          item.item_code || "—",
                          renderBudgetDescription(item),
                          isLeaf ? "Ejecutable" : "Agrupador",
                          isLeaf ? item.unit : "",
                          isLeaf ? formatNumber(Number(item.base_quantity), 4) : "",
                          isLeaf ? formatCurrency(Number(item.unit_price)) : "",
                          isLeaf ? formatCurrency(Number(item.partial_amount)) : "",
                        ];
                      }),
                        [
                          "",
                          <span key="total-label" className="font-semibold">Subtotal general</span>,
                          <span key="total-type" className="font-semibold">Solo hojas</span>,
                          "",
                          "",
                          "",
                          <span key="total-value" className="font-semibold">{formatCurrency(registeredTotal)}</span>,
                        ],
                      ]}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </div>
      </PageLayout>
    </AuthGuard>
  );
}

type MetradoLineRow = {
  id: string;
  item_id: string;
  period_id: string | null;
  group_label: string | null;
  location_ref: string | null;
  description: string | null;
  num_elements: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  formula: string | null;
  partial: number;
  observation: string | null;
  sort_order?: number | null;
};

type MetradoPeriod = {
  id: string;
  project_id: string;
  period_number: number;
  date_from: string;
  date_to: string;
};

function computeLinePartialLocal(line: Partial<MetradoLineRow>): number {
  const n = Number(line.num_elements ?? 1) || 1;
  const l = line.length != null && line.length !== 0 ? Number(line.length) : 1;
  const w = line.width != null && line.width !== 0 ? Number(line.width) : 1;
  const h = line.height != null && line.height !== 0 ? Number(line.height) : 1;
  const r = n * l * w * h;
  return Math.round(r * 10000) / 10000;
}

/** Compara códigos jerárquicos tipo "01.02.03" de forma natural. */
function compareItemCodes(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number(pa[i] ?? "0");
    const nb = Number(pb[i] ?? "0");
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    const sa = pa[i] ?? "";
    const sb = pb[i] ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
  }
  return 0;
}

export function MetradosPage() {
  const { projects, budgetItems } = useWorkspace();
  const { user } = useAuth();
  const [projectId, setProjectId] = useState<string>("");
  const [periods, setPeriods] = useState<MetradoPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string>("");
  const [lines, setLines] = useState<MetradoLineRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyExecutables, setOnlyExecutables] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const projectItems = useMemo(
    () => budgetItems.filter((b) => b.project_id === projectId),
    [budgetItems, projectId],
  );

  const parentSet = useMemo(
    () => buildParentCodeSet(projectItems.map((b) => ({ item_code: b.item_code }))),
    [projectItems],
  );

  // Items hoja (ejecutables/medibles) — única fuente para alta de líneas
  const leafItems = useMemo(
    () =>
      projectItems
        .filter((b) => isLeafByCode(b.item_code, parentSet))
        .slice()
        .sort((a, b) => compareItemCodes(a.item_code ?? "", b.item_code ?? "")),
    [projectItems, parentSet],
  );

  // Items para mostrar en árbol (todos por defecto, o solo hojas si se filtra)
  const visibleItems = useMemo(() => {
    const base = onlyExecutables ? leafItems : projectItems.slice();
    base.sort((a, b) => compareItemCodes(a.item_code ?? "", b.item_code ?? ""));
    if (!search.trim()) return base;
    const q = search.trim().toLowerCase();
    return base.filter((it) => {
      const code = (it.item_code ?? "").toLowerCase();
      const desc = (it.description ?? "").toLowerCase();
      return code.includes(q) || desc.includes(q);
    });
  }, [leafItems, projectItems, onlyExecutables, search]);

  // Si la búsqueda matchea algo, expandir automáticamente sus padres
  const matchedAncestors = useMemo(() => {
    if (!search.trim()) return new Set<string>();
    const set = new Set<string>();
    for (const it of visibleItems) {
      const code = it.item_code ?? "";
      const parts = code.split(".");
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("."));
    }
    return set;
  }, [visibleItems, search]);

  useEffect(() => {
    if (!projectId) {
      setPeriods([]);
      setPeriodId("");
      return;
    }
    void supabase
      .from("valuation_periods")
      .select("id,project_id,period_number,date_from,date_to")
      .eq("project_id", projectId)
      .order("period_number")
      .then(({ data }) => {
        const list = (data ?? []) as MetradoPeriod[];
        setPeriods(list);
        if (list.length) setPeriodId((curr) => curr || list[0].id);
      });
  }, [projectId]);

  useEffect(() => {
    if (!periodId) {
      setLines([]);
      return;
    }
    setLoading(true);
    void supabase
      .from("metrado_lines")
      .select("*")
      .eq("period_id", periodId)
      .order("sort_order")
      .then(({ data }) => {
        setLines((data ?? []) as MetradoLineRow[]);
        setLoading(false);
      });
  }, [periodId]);

  async function addLine(itemId: string) {
    if (!periodId || !user) return;
    const sortOrder = lines.filter((l) => l.item_id === itemId).length + 1;
    const { data, error } = await supabase
      .from("metrado_lines")
      .insert({
        item_id: itemId,
        period_id: periodId,
        project_id: projectId,
        sort_order: sortOrder,
        num_elements: 1,
        length: 0,
        width: 0,
        height: 0,
        partial: 0,
        created_by: user.id,
      })
      .select("*")
      .single();
    if (!error && data) setLines((l) => [...l, data as MetradoLineRow]);
  }

  async function updateLine(id: string, patch: Partial<MetradoLineRow>) {
    const current = lines.find((l) => l.id === id);
    if (!current) return;
    const merged = { ...current, ...patch } as MetradoLineRow;
    const partial = computeLinePartialLocal(merged);
    setLines((prev) => prev.map((l) => (l.id === id ? { ...merged, partial } : l)));
    const { id: _ignoreId, period_id: _ignorePeriodId, ...safePatch } = patch as Record<string, unknown> & {
      id?: string;
      period_id?: string | null;
    };
    await supabase
      .from("metrado_lines")
      .update({ ...(safePatch as Record<string, unknown>), partial })
      .eq("id", id);
  }

  async function deleteLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
    await supabase.from("metrado_lines").delete().eq("id", id);
  }

  const linesByItem = useMemo(() => {
    const m = new Map<string, MetradoLineRow[]>();
    for (const l of lines) {
      if (!m.has(l.item_id)) m.set(l.item_id, []);
      m.get(l.item_id)!.push(l);
    }
    return m;
  }, [lines]);

  // Conteo de líneas por código (incluye descendientes) para mostrar en agrupadores
  const itemsByCode = useMemo(() => {
    const m = new Map<string, BudgetItemRow>();
    for (const it of projectItems) {
      const c = (it.item_code ?? "").trim();
      if (c) m.set(c, it);
    }
    return m;
  }, [projectItems]);

  function toggleGroup(code: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function isExpanded(code: string) {
    if (search.trim() && matchedAncestors.has(code)) return true;
    return expandedGroups.has(code);
  }

  const project = projects.find((p) => p.id === projectId);
  const period = periods.find((p) => p.id === periodId);
  const activeItem = activeItemId ? projectItems.find((it) => it.id === activeItemId) : null;
  const activeItemLines = activeItem ? linesByItem.get(activeItem.id) ?? [] : [];
  const activeTotal = activeItemLines.reduce((acc, l) => acc + Number(l.partial || 0), 0);

  // Render del árbol jerárquico (lista plana ordenada con indentación e iconos)
  const treeRows = useMemo(() => {
    type Row = { item: BudgetItemRow; isLeafRow: boolean; level: number; visible: boolean };
    const sorted = projectItems
      .slice()
      .sort((a, b) => compareItemCodes(a.item_code ?? "", b.item_code ?? ""));

    // Determine which items pass the search/filter individually
    const visibleIds = new Set(visibleItems.map((i) => i.id));

    // For ancestors of visible items, force them to be shown so the tree is navigable
    const forceShow = new Set<string>();
    for (const it of visibleItems) {
      const code = it.item_code ?? "";
      const parts = code.split(".");
      for (let i = 1; i < parts.length; i++) {
        const ancestor = parts.slice(0, i).join(".");
        const a = itemsByCode.get(ancestor);
        if (a) forceShow.add(a.id);
      }
    }

    const rows: Row[] = [];
    for (const it of sorted) {
      const code = it.item_code ?? "";
      if (!code) continue;
      const level = code.split(".").length - 1;
      const isLeafRow = isLeafByCode(code, parentSet);

      // Visibilidad por filtros
      const passesFilter = visibleIds.has(it.id) || forceShow.has(it.id);
      if (!passesFilter) continue;

      // Visibilidad por estado expandido: ocultar si algún ancestro está colapsado
      const parts = code.split(".");
      let parentCollapsed = false;
      for (let i = 1; i < parts.length; i++) {
        const ancestor = parts.slice(0, i).join(".");
        if (itemsByCode.has(ancestor) && !isExpanded(ancestor)) {
          parentCollapsed = true;
          break;
        }
      }
      if (parentCollapsed) continue;

      rows.push({ item: it, isLeafRow, level, visible: true });
    }
    return rows;
  }, [projectItems, parentSet, visibleItems, itemsByCode, expandedGroups, search, matchedAncestors]);

  async function handleGeneratePdf() {
    if (!project || !period) {
      toast.error("Selecciona un proyecto y un período antes de generar el documento.");
      return;
    }
    setGeneratingPdf(true);
    const tid = toast.loading("Generando documento de Metrados de partidas ejecutadas…");
    try {
      const { generateMetradosPdf } = await import("@/lib/metrados-pdf");
      const res = await generateMetradosPdf({
        project,
        period: {
          id: period.id,
          period_number: period.period_number,
          date_from: period.date_from,
          date_to: period.date_to,
        },
        items: projectItems,
        currentLines: lines as any,
      });
      toast.dismiss(tid);
      toast.success("Documento generado correctamente.");
      const a = document.createElement("a");
      a.href = res.url;
      a.download = res.fileName;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) {
      toast.dismiss(tid);
      console.error("[MetradosPdf] failed", e);
      toast.error(e?.message ?? "Error generando el documento.");
    } finally {
      setGeneratingPdf(false);
    }
  }

  return (
    <AuthGuard>
      <PageLayout
        title="Metrados"
        description="Captura de metrados por partida ejecutable. La descripción de cada partida proviene del presupuesto importado."
        actions={
          projectId && periodId ? (
            <Button onClick={() => void handleGeneratePdf()} disabled={generatingPdf}>
              {generatingPdf ? "Generando…" : "Generar PDF metrados"}
            </Button>
          ) : null
        }
      >
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Selección de proyecto y período</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Proyecto</label>
              <Select value={projectId} onValueChange={(v) => { setProjectId(v); setActiveItemId(null); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona proyecto" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Período de valorización</label>
              <Select value={periodId} onValueChange={setPeriodId} disabled={!projectId || !periods.length}>
                <SelectTrigger>
                  <SelectValue placeholder={periods.length ? "Selecciona período" : "Sin períodos creados"} />
                </SelectTrigger>
                <SelectContent>
                  {periods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      Período {p.period_number} ({formatDate(p.date_from)} – {formatDate(p.date_to)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!periods.length && projectId ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Crea un período desde Memoria valorizada e Informe Técnico antes de capturar metrados.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {projectId && periodId ? (
          <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
            {/* Panel lateral: árbol jerárquico de partidas */}
            <Card className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden">
              <CardHeader className="space-y-3">
                <CardTitle className="text-base">Partidas del proyecto</CardTitle>
                <Input
                  placeholder="Buscar por ítem o descripción…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={onlyExecutables}
                      onChange={(e) => setOnlyExecutables(e.target.checked)}
                    />
                    Solo ítems ejecutables
                  </label>
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={() => setExpandedGroups(new Set(itemsByCode.keys()))}
                  >
                    Expandir todo
                  </button>
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={() => setExpandedGroups(new Set())}
                  >
                    Contraer todo
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {leafItems.length} ítems ejecutables · {projectItems.length} totales
                </p>
              </CardHeader>
              <CardContent className="lg:max-h-[calc(100vh-22rem)] lg:overflow-y-auto">
                {treeRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {projectItems.length === 0
                      ? "Este proyecto no tiene partidas. Importa primero el presupuesto."
                      : "Sin coincidencias para la búsqueda."}
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {treeRows.map(({ item, isLeafRow, level }) => {
                      const code = item.item_code ?? "";
                      const open = isExpanded(code);
                      const isActive = activeItemId === item.id;
                      const lineCount = linesByItem.get(item.id)?.length ?? 0;
                      return (
                        <li key={item.id}>
                          <div
                            className={`flex items-start gap-1 rounded px-1.5 py-1 text-sm ${
                              isActive ? "bg-primary/10" : "hover:bg-muted/60"
                            }`}
                            style={{ paddingLeft: 6 + level * 12 }}
                          >
                            {!isLeafRow ? (
                              <button
                                type="button"
                                onClick={() => toggleGroup(code)}
                                className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                                aria-label={open ? "Contraer" : "Expandir"}
                              >
                                {open ? "▾" : "▸"}
                              </button>
                            ) : (
                              <span className="mt-0.5 inline-block h-4 w-4 shrink-0" />
                            )}
                            <button
                              type="button"
                              onClick={() => isLeafRow && setActiveItemId(item.id)}
                              disabled={!isLeafRow}
                              className={`flex min-w-0 flex-1 flex-col text-left ${
                                isLeafRow ? "cursor-pointer" : "cursor-default"
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">{code}</span>
                                {isLeafRow && lineCount > 0 ? (
                                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                                    {lineCount}
                                  </Badge>
                                ) : null}
                              </span>
                              <span
                                className={`truncate text-xs ${
                                  isLeafRow ? "text-foreground" : "font-semibold uppercase text-foreground"
                                }`}
                                title={item.description}
                              >
                                {item.description}
                              </span>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Panel principal: edición de la partida activa */}
            <div className="space-y-4">
              {!activeItem ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    Selecciona una subpartida ejecutable del panel izquierdo para registrar líneas de metrado.
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Subpartida seleccionada
                    </div>
                    <CardTitle className="flex flex-wrap items-baseline gap-2 text-base">
                      <span className="font-mono text-sm text-muted-foreground">
                        {activeItem.item_code ?? "—"}
                      </span>
                      <span>{activeItem.description}</span>
                    </CardTitle>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Und: <span className="font-medium text-foreground">{activeItem.unit || "—"}</span></span>
                      <span>Metrado base: <span className="font-medium text-foreground">{formatNumber(Number(activeItem.base_quantity || 0), 4)}</span></span>
                      <span>Acumulado período: <span className="font-medium text-foreground">{formatNumber(activeTotal, 4)}</span></span>
                      <span>Líneas: <span className="font-medium text-foreground">{activeItemLines.length}</span></span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => void addLine(activeItem.id)}>
                        + Agregar línea de metrado
                      </Button>
                    </div>
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[110px]">Partida</TableHead>
                            <TableHead className="min-w-[220px]">Descripción</TableHead>
                            <TableHead className="w-[70px]">Und.</TableHead>
                            <TableHead className="w-[90px]">Largo</TableHead>
                            <TableHead className="w-[90px]">Ancho</TableHead>
                            <TableHead className="w-[90px]">Alt.</TableHead>
                            <TableHead className="w-[90px]">N° Elem.</TableHead>
                            <TableHead className="w-[110px] text-right">Parcial</TableHead>
                            <TableHead className="w-[50px]" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {/* Encabezado de la subpartida (una sola vez) */}
                          <TableRow className="bg-muted/40">
                            <TableCell className="font-mono text-sm font-semibold">
                              {activeItem.item_code ?? "—"}
                            </TableCell>
                            <TableCell className="text-sm font-semibold">
                              {activeItem.description}
                            </TableCell>
                            <TableCell className="text-sm font-medium">{activeItem.unit}</TableCell>
                            <TableCell colSpan={6} />
                          </TableRow>
                          {activeItemLines.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                                Sin detalles de cálculo. Usa “+ Agregar línea de metrado” para añadir el sustento (tramo, sector, etc.).
                              </TableCell>
                            </TableRow>
                          ) : (
                            activeItemLines.map((line) => (
                              <TableRow key={line.id}>
                                <TableCell />
                                {/* Detalle libre: tramo / ubicación / sector */}
                                <TableCell>
                                  <Input
                                    value={line.description ?? ""}
                                    placeholder="Tramo, sector, ubicación…"
                                    onChange={(e) =>
                                      updateLine(line.id, { description: e.target.value || null })
                                    }
                                  />
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{activeItem.unit}</TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={line.length ?? ""}
                                    onChange={(e) =>
                                      updateLine(line.id, {
                                        length: e.target.value === "" ? null : Number(e.target.value),
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={line.width ?? ""}
                                    onChange={(e) =>
                                      updateLine(line.id, {
                                        width: e.target.value === "" ? null : Number(e.target.value),
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={line.height ?? ""}
                                    onChange={(e) =>
                                      updateLine(line.id, {
                                        height: e.target.value === "" ? null : Number(e.target.value),
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    step="1"
                                    value={line.num_elements ?? 1}
                                    onChange={(e) =>
                                      updateLine(line.id, {
                                        num_elements: e.target.value === "" ? null : Number(e.target.value),
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatNumber(Number(line.partial || 0), 4)}
                                </TableCell>
                                <TableCell>
                                  <Button size="sm" variant="ghost" onClick={() => void deleteLine(line.id)}>
                                    ✕
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={7} className="text-right text-sm font-medium">
                              Total {activeItem.unit}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              {formatNumber(activeTotal, 4)}
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
              {loading ? <p className="text-sm text-muted-foreground">Cargando líneas…</p> : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Selecciona un proyecto y un período para capturar los metrados de partidas ejecutadas.
          </p>
        )}
      </PageLayout>
    </AuthGuard>
  );
}

export function MemoriasPage() {
  const { projects, memorias, refresh } = useWorkspace();
  const { user } = useAuth();
  const form = useForm<z.infer<typeof memoriaSchema>>({ resolver: zodResolver(memoriaSchema) });
  const [content, setContent] = useState("<p>Describir el avance físico ejecutado, frentes de trabajo y sustento técnico.</p>");

  const submit = form.handleSubmit(async (values) => {
    if (!user) return;
    const { error } = await supabase.from("memoria_valorizada").insert({
      ...values,
      period_month: toPeriodDate(values.period_month),
      created_by: user.id,
      content_json: { html: content, plainText: stripHtml(content) },
      status: "draft",
    });
    if (error) {
      form.setError("root", { message: error.message });
      return;
    }
    form.reset();
    setContent("<p></p>");
    await refresh();
  });

  const updateStatus = async (id: string, status: "in_review" | "approved" | "rejected") => {
    if (!user) return;
    await supabase.from("memoria_valorizada").update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", id);
    await refresh();
  };

  return (
    <AuthGuard>
      <PageLayout title="Memoria valorizada" description="Documento obligatorio previo a cualquier valorización mensual.">
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader><CardTitle>Redactar memoria</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Form {...form}>
                <form className="space-y-4" onSubmit={submit}>
                  <div className="grid gap-4 md:grid-cols-2"><FormField control={form.control} name="project_id" render={({ field }) => <FormItem><FormLabel>Proyecto</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Selecciona proyecto" /></SelectTrigger></FormControl><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} /><FormField control={form.control} name="period_month" render={({ field }) => <FormItem><FormLabel>Periodo</FormLabel><FormControl><Input type="month" {...field} /></FormControl><FormMessage /></FormItem>} /></div>
                  <FormField control={form.control} name="title" render={({ field }) => <FormItem><FormLabel>Título</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
                  <FormField control={form.control} name="executive_summary" render={({ field }) => <FormItem><FormLabel>Resumen ejecutivo</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl></FormItem>} />
                  <div className="space-y-2"><label className="text-sm font-medium text-foreground">Contenido técnico</label><RichTextEditor value={content} onChange={setContent} /></div>
                  {form.formState.errors.root ? <p className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
                  <Button type="submit">Guardar memoria</Button>
                </form>
              </Form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Memorias del período</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {memorias.slice(0, 10).map((memoria) => {
                const rich = parseRichTextDocument(memoria.content_json);
                const project = projects.find((item) => item.id === memoria.project_id);
                return (
                  <div key={memoria.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{memoria.title}</p>
                        <p className="text-xs text-muted-foreground">{project?.name || "Proyecto"} · {getPeriodLabel(memoria.period_month)}</p>
                      </div>
                      <Badge variant="outline">{documentStatusLabels[memoria.status]}</Badge>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{rich.plainText || memoria.executive_summary || "Sin detalle"}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => updateStatus(memoria.id, "in_review")}>Enviar a revisión</Button>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(memoria.id, "approved")}>Aprobar</Button>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(memoria.id, "rejected")}>Observar</Button>
                      {project ? <Button size="sm" variant="ghost" onClick={() => exportMemoriaPdf(project, memoria)}>PDF</Button> : null}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </AuthGuard>
  );
}

export function ValuationsPage() {
  const { projects, budgetItems, metrados, memorias, valuations, valuationLines, refresh } = useWorkspace();
  const { user } = useAuth();
  const form = useForm<z.infer<typeof valuationSchema>>({ resolver: zodResolver(valuationSchema), defaultValues: { deductions_amount: 0, progress_percent: 0 } });

  const createValuation = form.handleSubmit(async (values) => {
    if (!user) return;
    const periodMonth = toPeriodDate(values.period_month);
    const project = projects.find((item) => item.id === values.project_id);
    const memoria = memorias.find((item) => item.project_id === values.project_id && item.period_month === periodMonth);
    if (!project || !memoria) {
      form.setError("root", { message: "Debe existir una memoria valorizada para el período seleccionado." });
      return;
    }

    const entries = metrados.filter((entry) => entry.project_id === values.project_id && entry.period_month === periodMonth && entry.status === "validated");
    if (!entries.length) {
      form.setError("root", { message: "Debe haber metrados validados en el período." });
      return;
    }

    const items = budgetItems.filter((item) => item.project_id === values.project_id);
    const grouped = entries.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.item_id] = (acc[entry.item_id] || 0) + Number(entry.quantity);
      return acc;
    }, {});

    const lines = Object.entries(grouped).map(([itemId, quantity]) => {
      const item = items.find((row) => row.id === itemId);
      const previousAccumulated = valuationLines
        .filter((line) => line.item_id === itemId)
        .reduce((sum, line) => sum + Number(line.quantity_period), 0);
      return {
        item_id: itemId,
        quantity_period: quantity,
        quantity_accumulated: previousAccumulated + quantity,
        unit_price_applied: Number(item?.unit_price || 0),
        percentage_applied: project.contract_type === "suma_alzada" ? Number(values.progress_percent || 0) : 0,
        line_amount: project.contract_type === "suma_alzada"
          ? (Number(project.contract_amount) * Number(values.progress_percent || 0)) / 100
          : quantity * Number(item?.unit_price || 0),
      };
    });

    const grossAmount = project.contract_type === "suma_alzada"
      ? (Number(project.contract_amount) * Number(values.progress_percent || 0)) / 100
      : lines.reduce((sum, line) => sum + line.line_amount, 0);

    const valuationResult = await supabase.from("valuations").insert({
      project_id: values.project_id,
      period_month: periodMonth,
      memoria_id: memoria.id,
      total_quantity: entries.reduce((sum, entry) => sum + Number(entry.quantity), 0),
      progress_percent: project.contract_type === "suma_alzada" ? Number(values.progress_percent || 0) : calculateProjectProgress(project, valuations),
      gross_amount: grossAmount,
      deductions_amount: Number(values.deductions_amount),
      net_amount: grossAmount - Number(values.deductions_amount),
      created_by: user.id,
      contract_type_snapshot: project.contract_type,
      status: "pending",
    }).select("id").single();

    if (valuationResult.error) {
      form.setError("root", { message: valuationResult.error.message });
      return;
    }

    const linesResult = await supabase.from("valuation_lines").insert(lines.map((line) => ({ ...line, valuation_id: valuationResult.data.id })));
    if (linesResult.error) {
      form.setError("root", { message: linesResult.error.message });
      return;
    }

    form.reset({ deductions_amount: 0, progress_percent: 0 });
    await refresh();
  });

  const updateStatus = async (id: string, status: "reviewed" | "approved" | "rejected") => {
    if (!user) return;
    const payload = status === "approved"
      ? { status, supervisor_reviewed_by: user.id, supervisor_reviewed_at: new Date().toISOString() }
      : { status, resident_reviewed_by: user.id, resident_reviewed_at: new Date().toISOString() };
    await supabase.from("valuations").update(payload).eq("id", id);
    await refresh();
  };

  return (
    <AuthGuard>
      <PageLayout title="Valorizaciones" description="Cálculo mensual condicionado por memoria aprobada y metrados validados.">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardHeader><CardTitle>Generar valorización</CardTitle></CardHeader>
            <CardContent>
              <Form {...form}>
                <form className="space-y-4" onSubmit={createValuation}>
                  <div className="grid gap-4 md:grid-cols-2"><FormField control={form.control} name="project_id" render={({ field }) => <FormItem><FormLabel>Proyecto</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Selecciona proyecto" /></SelectTrigger></FormControl><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} /><FormField control={form.control} name="period_month" render={({ field }) => <FormItem><FormLabel>Periodo</FormLabel><FormControl><Input type="month" {...field} /></FormControl><FormMessage /></FormItem>} /></div>
                  <div className="grid gap-4 md:grid-cols-2"><FormField control={form.control} name="deductions_amount" render={({ field }) => <FormItem><FormLabel>Deducciones</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="progress_percent" render={({ field }) => <FormItem><FormLabel>% avance (suma alzada)</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormDescription>Solo aplica para contratos a suma alzada.</FormDescription></FormItem>} /></div>
                  {form.formState.errors.root ? <p className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
                  <Button type="submit">Calcular y guardar</Button>
                </form>
              </Form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Histórico de valorizaciones</CardTitle></CardHeader>
            <CardContent>
              {valuations.map((valuation) => {
                const project = projects.find((item) => item.id === valuation.project_id);
                const lines = valuationLines.filter((line) => line.valuation_id === valuation.id);
                return (
                  <div key={valuation.id} className="mb-4 rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{project?.name || "Proyecto"}</p>
                        <p className="text-xs text-muted-foreground">{getPeriodLabel(valuation.period_month)} · {contractTypeLabels[valuation.contract_type_snapshot]}</p>
                      </div>
                      <Badge variant="outline">{valuationStatusLabels[valuation.status]}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
                      <p>Bruto: {formatCurrency(Number(valuation.gross_amount), project?.currency_code || "PEN")}</p>
                      <p>Deducciones: {formatCurrency(Number(valuation.deductions_amount), project?.currency_code || "PEN")}</p>
                      <p>Neto: {formatCurrency(Number(valuation.net_amount), project?.currency_code || "PEN")}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => updateStatus(valuation.id, "reviewed")}>Revisar</Button>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(valuation.id, "approved")}>Aprobar</Button>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(valuation.id, "rejected")}>Rechazar</Button>
                      {project ? <Button size="sm" variant="ghost" onClick={() => exportValuationPdf(project, valuation, lines)}>PDF</Button> : null}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </AuthGuard>
  );
}

export function ApprovalsPage() {
  const { memorias, valuations, projects } = useWorkspace();
  const pendingMemorias = memorias.filter((item) => item.status === "in_review");
  const pendingValuations = valuations.filter((item) => item.status === "pending" || item.status === "reviewed");

  return (
    <AuthGuard>
      <PageLayout title="Aprobaciones" description="Cola operativa para revisión del residente y aprobación del supervisor.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>Memorias en revisión</CardTitle></CardHeader><CardContent><SectionTable headers={["Proyecto", "Periodo", "Estado"]} rows={pendingMemorias.map((item) => [projects.find((project) => project.id === item.project_id)?.name || "Proyecto", getPeriodLabel(item.period_month), documentStatusLabels[item.status]])} /></CardContent></Card>
          <Card><CardHeader><CardTitle>Valorizaciones por decidir</CardTitle></CardHeader><CardContent><SectionTable headers={["Proyecto", "Periodo", "Neto", "Estado"]} rows={pendingValuations.map((item) => [projects.find((project) => project.id === item.project_id)?.name || "Proyecto", getPeriodLabel(item.period_month), formatCurrency(Number(item.net_amount)), valuationStatusLabels[item.status]])} /></CardContent></Card>
        </div>
      </PageLayout>
    </AuthGuard>
  );
}

export function ReportsPage() {
  const { projects, valuations, metrados, budgetItems } = useWorkspace();

  return (
    <AuthGuard>
      <PageLayout title="Reportes" description="Consolidados financieros y exportes operativos para control de obra." actions={<Button variant="outline" onClick={() => exportFinancialWorkbook(projects, valuations)}>Exportar Excel</Button>}>
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Card><CardHeader><CardTitle>Resumen financiero</CardTitle></CardHeader><CardContent><SectionTable headers={["Proyecto", "Contrato", "Valorizado aprobado"]} rows={projects.map((project) => [project.name, formatCurrency(Number(project.contract_amount), project.currency_code), formatCurrency(valuations.filter((item) => item.project_id === project.id && item.status === "approved").reduce((sum, item) => sum + Number(item.net_amount), 0), project.currency_code)])} /></CardContent></Card>
          <Card><CardHeader><CardTitle>Exportes rápidos</CardTitle></CardHeader><CardContent className="space-y-3">{projects.map((project) => <div key={project.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"><div><p className="text-sm font-medium text-foreground">{project.name}</p><p className="text-xs text-muted-foreground">{budgetItems.filter((item) => item.project_id === project.id).length} partidas · {metrados.filter((item) => item.project_id === project.id).length} metrados</p></div><Button size="sm" variant="outline" onClick={() => exportMetradosWorkbook(project, metrados.filter((item) => item.project_id === project.id), Object.fromEntries(budgetItems.map((item) => [item.id, item.description])))}>Excel metrados</Button></div>)}</CardContent></Card>
        </div>
      </PageLayout>
    </AuthGuard>
  );
}

export function LiquidationPage() {
  const { projects, valuations, liquidations, refresh } = useWorkspace();
  const { user } = useAuth();
  const form = useForm<z.infer<typeof liquidationSchema>>({ resolver: zodResolver(liquidationSchema), defaultValues: { total_deductions_amount: 0 } });

  const submit = form.handleSubmit(async (values) => {
    if (!user) return;
    const project = projects.find((item) => item.id === values.project_id);
    const approved = valuations.filter((item) => item.project_id === values.project_id && item.status === "approved");
    const totalValued = approved.reduce((sum, item) => sum + Number(item.net_amount), 0);
    const { error } = await supabase.from("liquidations").insert({
      project_id: values.project_id,
      summary_text: values.summary_text || null,
      total_valued_amount: totalValued,
      total_deductions_amount: Number(values.total_deductions_amount),
      final_amount: totalValued - Number(values.total_deductions_amount),
      created_by: user.id,
      status: "draft",
    });
    if (error) {
      form.setError("root", { message: `${error.message}${project?.status !== "closing" && project?.status !== "closed" ? " · Pon el proyecto en cierre para liquidar." : ""}` });
      return;
    }
    form.reset({ total_deductions_amount: 0 });
    await refresh();
  });

  return (
    <AuthGuard>
      <PageLayout title="Liquidación" description="Cierre económico final del proyecto una vez completado el historial de valorizaciones.">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card><CardHeader><CardTitle>Generar liquidación</CardTitle></CardHeader><CardContent><Form {...form}><form className="space-y-4" onSubmit={submit}><FormField control={form.control} name="project_id" render={({ field }) => <FormItem><FormLabel>Proyecto</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Selecciona proyecto" /></SelectTrigger></FormControl><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} /><FormField control={form.control} name="total_deductions_amount" render={({ field }) => <FormItem><FormLabel>Deducciones finales</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="summary_text" render={({ field }) => <FormItem><FormLabel>Resumen de cierre</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl></FormItem>} />{form.formState.errors.root ? <p className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}<Button type="submit">Generar liquidación</Button></form></Form></CardContent></Card>
          <Card><CardHeader><CardTitle>Liquidaciones registradas</CardTitle></CardHeader><CardContent>{liquidations.map((liquidation) => { const project = projects.find((item) => item.id === liquidation.project_id); const relatedValuations = valuations.filter((item) => item.project_id === liquidation.project_id && item.status === "approved"); return <div key={liquidation.id} className="mb-4 rounded-lg border border-border p-4"><p className="text-sm font-medium text-foreground">{project?.name || "Proyecto"}</p><p className="mt-2 text-sm text-muted-foreground">Monto final: {formatCurrency(Number(liquidation.final_amount), project?.currency_code || "PEN")}</p><div className="mt-3 flex gap-2">{project ? <Button size="sm" variant="outline" onClick={() => exportLiquidationPdf(project, liquidation, relatedValuations)}>PDF</Button> : null}</div></div>; })}</CardContent></Card>
        </div>
      </PageLayout>
    </AuthGuard>
  );
}

export function DocumentsPage() {
  const { projects, memorias, valuations, valuationLines, liquidations, metrados, budgetItems } = useWorkspace();
  const itemMap = Object.fromEntries(budgetItems.map((item) => [item.id, item.description]));

  return (
    <AuthGuard>
      <PageLayout title="Centro de documentos" description="Exportación operativa de memorias, valorizaciones, metrados y liquidaciones.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>PDF</CardTitle></CardHeader><CardContent className="space-y-3">{projects.map((project) => <div key={project.id} className="rounded-md border border-border p-3"><p className="text-sm font-medium text-foreground">{project.name}</p><div className="mt-3 flex flex-wrap gap-2">{memorias.filter((item) => item.project_id === project.id).slice(0, 1).map((memoria) => <Button key={memoria.id} size="sm" variant="outline" onClick={() => exportMemoriaPdf(project, memoria)}>Memoria PDF</Button>)}{valuations.filter((item) => item.project_id === project.id).slice(0, 1).map((valuation) => <Button key={valuation.id} size="sm" variant="outline" onClick={() => exportValuationPdf(project, valuation, valuationLines.filter((line) => line.valuation_id === valuation.id))}>Valorización PDF</Button>)}{liquidations.filter((item) => item.project_id === project.id).slice(0, 1).map((liquidation) => <Button key={liquidation.id} size="sm" variant="outline" onClick={() => exportLiquidationPdf(project, liquidation, valuations.filter((valuation) => valuation.project_id === project.id))}>Liquidación PDF</Button>)}</div></div>)}</CardContent></Card>
          <Card><CardHeader><CardTitle>Excel</CardTitle></CardHeader><CardContent className="space-y-3">{projects.map((project) => <div key={project.id} className="rounded-md border border-border p-3"><p className="text-sm font-medium text-foreground">{project.name}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => exportMetradosWorkbook(project, metrados.filter((entry) => entry.project_id === project.id), itemMap)}>Metrados</Button></div></div>)}</CardContent></Card>
        </div>
      </PageLayout>
    </AuthGuard>
  );
}

export function UsersPage() {
  const { profiles, userRoles, refresh } = useWorkspace();
  const { isAdmin } = useAuth();
  const [selectedRole, setSelectedRole] = useState<Record<string, string>>({});

  const assignRole = async (userId: string) => {
    const role = selectedRole[userId];
    if (!role) return;
    await supabase.from("user_roles").insert({ user_id: userId, role: role as never });
    await refresh();
  };

  return (
    <AuthGuard requireAdmin>
      <PageLayout title="Usuarios y roles" description="Asignación segura de roles separados del perfil de usuario.">
        {isAdmin ? <SectionTable headers={["Usuario", "Cargo", "Roles", "Asignar"]} rows={profiles.map((profile) => [profile.full_name || profile.user_id, profile.job_title || "—", userRoles.filter((role) => role.user_id === profile.user_id).map((role) => roleLabels[role.role]).join(", "), <div key={profile.id} className="flex gap-2"><Select value={selectedRole[profile.user_id] || ""} onValueChange={(value) => setSelectedRole((current) => ({ ...current, [profile.user_id]: value }))}><SelectTrigger className="w-44"><SelectValue placeholder="Rol" /></SelectTrigger><SelectContent>{Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" onClick={() => void assignRole(profile.user_id)}>Asignar</Button></div>])} /> : null}
      </PageLayout>
    </AuthGuard>
  );
}

export function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const form = useForm<z.infer<typeof settingsSchema>>({ resolver: zodResolver(settingsSchema), values: { full_name: profile?.full_name || "", job_title: profile?.job_title || "", phone: profile?.phone || "", signature_url: profile?.signature_url || "" } });

  const submit = form.handleSubmit(async (values) => {
    if (!profile) return;
    const { error } = await supabase.from("profiles").update(values).eq("id", profile.id);
    if (error) {
      form.setError("root", { message: error.message });
      return;
    }
    await refreshProfile();
  });

  return (
    <AuthGuard>
      <PageLayout title="Configuración" description="Perfil básico, firma y datos de contacto para trazabilidad documental.">
        <Card className="max-w-2xl"><CardHeader><CardTitle>Perfil de usuario</CardTitle></CardHeader><CardContent><Form {...form}><form className="space-y-4" onSubmit={submit}><FormField control={form.control} name="full_name" render={({ field }) => <FormItem><FormLabel>Nombre completo</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} /><div className="grid gap-4 md:grid-cols-2"><FormField control={form.control} name="job_title" render={({ field }) => <FormItem><FormLabel>Cargo</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>} /><FormField control={form.control} name="phone" render={({ field }) => <FormItem><FormLabel>Teléfono</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>} /></div><FormField control={form.control} name="signature_url" render={({ field }) => <FormItem><FormLabel>URL de firma</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormDescription>Usa una imagen alojada en un servicio seguro o bucket interno.</FormDescription></FormItem>} />{form.formState.errors.root ? <p className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}<Button type="submit">Guardar cambios</Button></form></Form></CardContent></Card>
      </PageLayout>
    </AuthGuard>
  );
}

export function HomePage() {
  return (
    <PageLayout title="JJ&PP Ingenieros" description="Accede al sistema operativo para controlar metrados, valorizaciones y cierre económico de obra." actions={<Button asChild><Link to="/login">Ingresar al sistema</Link></Button>}>
      <div className="grid gap-6 lg:grid-cols-3">
        {["Control técnico", "Valorización mensual", "Liquidación final"].map((title, index) => (
          <Card key={title}><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{["Registro trazable de partidas, metrados y memorias valorizadas.","Cálculo por tipo contractual con revisión y aprobación.","Consolidación económica de obra con exportes listos."][index]}</CardDescription></CardHeader></Card>
        ))}
      </div>
    </PageLayout>
  );
}
