import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/components/app/workspace-provider";
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
import { parseRichTextDocument, stripHtml } from "@/lib/domain";
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

const fichaTecnicaSchema = z.object({
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
  status: z.enum(["draft", "active", "closing", "closed", "archived"]),
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
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {row.map((cell, cellIndex) => (
                <TableCell key={cellIndex}>{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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

function EditProjectDialog({ project, onSaved }: { project: EditableProject; onSaved: () => Promise<void> | void }) {
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
    setOpen(false);
    await onSaved();
  });

  const incomplete = isFichaTecnicaIncomplete(project);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={incomplete ? "default" : "outline"}>
          {incomplete ? "Completar ficha técnica" : "Editar"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar proyecto · Ficha técnica</DialogTitle>
          <DialogDescription>
            Información obligatoria que aparecerá en el Expediente Mensual de Supervisión/Valorización.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField control={form.control} name="entity_name" render={({ field }) => (
                <FormItem><FormLabel>Entidad *</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="Municipalidad / Entidad contratante" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="contractor_name" render={({ field }) => (
                <FormItem><FormLabel>Contratista *</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="supervisor_name" render={({ field }) => (
                <FormItem><FormLabel>Supervisor *</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="resident_name" render={({ field }) => (
                <FormItem><FormLabel>Residente *</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
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
                <FormItem><FormLabel>Fecha de inicio *</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="execution_term_days" render={({ field }) => (
                <FormItem><FormLabel>Plazo de ejecución (días) *</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="planned_end_date" render={({ field }) => (
                <FormItem><FormLabel>Fecha de término *</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
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

export function ProjectsPage() {
  const { projects, refresh } = useWorkspace();
  const { user, roles } = useAuth();
  const [open, setOpen] = useState(false);
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
        {projects.length === 0 ? (
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
            rows={projects.map((project) => {
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
                <EditProjectDialog key={`e-${project.id}`} project={project} onSaved={refresh} />,
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
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
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
              {preview ? <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{preview.warnings.length ? preview.warnings.join(" ") : `Se detectaron ${preview.rows.length} partidas listas para importar.`}</div> : null}
              {message ? <p className="text-sm text-primary">{message}</p> : null}
              <Button onClick={() => void uploadBudget()} disabled={!preview || !selectedProjectId}>Importar presupuesto</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Partidas registradas</CardTitle>
              <CardDescription>{currentItems.length} partidas cargadas para el proyecto seleccionado.</CardDescription>
            </CardHeader>
            <CardContent>
              <SectionTable
                headers={["Código", "Descripción", "Unidad", "Metrado base", "P.U.", "Parcial"]}
                rows={(preview?.rows ?? currentItems).slice(0, 12).map((item) => [
                  "item_code" in item ? item.item_code || "—" : item.item_code || "—",
                  item.description,
                  item.unit,
                  formatNumber(Number(item.base_quantity), 4),
                  formatCurrency(Number(item.unit_price)),
                  formatCurrency(Number(item.partial_amount)),
                ])}
              />
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </AuthGuard>
  );
}

export function MetradosPage() {
  const { projects, budgetItems, metrados, refresh } = useWorkspace();
  const { user } = useAuth();
  const form = useForm<z.infer<typeof metradoSchema>>({ resolver: zodResolver(metradoSchema) });
  const selectedProjectId = form.watch("project_id");
  const projectItems = budgetItems.filter((item) => item.project_id === selectedProjectId);

  const submit = form.handleSubmit(async (values) => {
    if (!user) return;
    const { error } = await supabase.from("metrado_entries").insert({
      ...values,
      created_by: user.id,
      period_month: toPeriodDate(values.period_month),
      status: "draft",
    });
    if (error) {
      form.setError("root", { message: error.message });
      return;
    }
    form.reset();
    await refresh();
  });

  const validateEntry = async (id: string) => {
    if (!user) return;
    await supabase.from("metrado_entries").update({ status: "validated", validated_by: user.id, validated_at: new Date().toISOString() }).eq("id", id);
    await refresh();
  };

  return (
    <AuthGuard>
      <PageLayout title="Metrados" description="Registro continuo por partida y período, con validación técnica para valorización.">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardHeader><CardTitle>Registrar metrado</CardTitle></CardHeader>
            <CardContent>
              <Form {...form}>
                <form className="space-y-4" onSubmit={submit}>
                  <FormField control={form.control} name="project_id" render={({ field }) => <FormItem><FormLabel>Proyecto</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Selecciona proyecto" /></SelectTrigger></FormControl><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
                  <FormField control={form.control} name="item_id" render={({ field }) => <FormItem><FormLabel>Partida</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Selecciona partida" /></SelectTrigger></FormControl><SelectContent>{projectItems.map((item) => <SelectItem key={item.id} value={item.id}>{item.description}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
                  <div className="grid gap-4 md:grid-cols-2"><FormField control={form.control} name="entry_date" render={({ field }) => <FormItem><FormLabel>Fecha</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="period_month" render={({ field }) => <FormItem><FormLabel>Periodo</FormLabel><FormControl><Input type="month" {...field} /></FormControl><FormDescription>Se guarda el primer día del mes.</FormDescription><FormMessage /></FormItem>} /></div>
                  <FormField control={form.control} name="quantity" render={({ field }) => <FormItem><FormLabel>Cantidad ejecutada</FormLabel><FormControl><Input type="number" step="0.0001" {...field} /></FormControl><FormMessage /></FormItem>} />
                  <FormField control={form.control} name="notes" render={({ field }) => <FormItem><FormLabel>Observaciones</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl></FormItem>} />
                  {form.formState.errors.root ? <p className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
                  <Button type="submit">Guardar metrado</Button>
                </form>
              </Form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Histórico por período</CardTitle></CardHeader>
            <CardContent>
              <SectionTable
                headers={["Fecha", "Periodo", "Cantidad", "Estado", "Acción"]}
                rows={metrados.slice(0, 12).map((entry) => [
                  formatDate(entry.entry_date),
                  getPeriodLabel(entry.period_month),
                  formatNumber(Number(entry.quantity), 4),
                  <Badge key={entry.id} variant="outline">{entry.status}</Badge>,
                  entry.status !== "validated" ? <Button key={entry.id} size="sm" variant="outline" onClick={() => void validateEntry(entry.id)}>Validar</Button> : "—",
                ])}
              />
            </CardContent>
          </Card>
        </div>
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
