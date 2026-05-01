import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, ArrowRight, Download, FileDown, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageLayout } from "@/components/app/page-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/components/app/workspace-provider";
import { isFichaTecnicaIncomplete } from "@/components/app/workspace-pages";
import { useAuth } from "@/lib/auth";
import {
  buildParentCodeSet,
  buildSummaryHierarchy,
  buildValuationTable,
  deductionLabels,
  formatMoney,
  formatNum,
  isLeafByCode,
  isMeasurableBudgetItem,
  totals,
  type DeductionLine,
  type MetradoLine,
} from "@/lib/expediente";
import { generateExpedienteClientPdf } from "@/lib/expediente-client-pdf";

export const Route = createFileRoute("/app/expediente")({
  component: ExpedientePage,
});

type Period = {
  id: string;
  project_id: string;
  period_number: number;
  date_from: string;
  date_to: string;
  status: string;
  generalidades: string | null;
  metas: string | null;
  ocurrencias: string | null;
  conclusiones: string | null;
  resumen_ejecutivo: string | null;
};

const STEPS = [
  { id: 1, label: "Proyecto y período" },
  { id: 2, label: "Ficha técnica" },
  { id: 3, label: "Memoria valorizada e informe técnico" },
  { id: 4, label: "Deducciones" },
  { id: 5, label: "Resumen y PDF" },
] as const;

function ExpedientePage() {
  const { user } = useAuth();
  const { projects, budgetItems } = useWorkspace();
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState<string>("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<string>("");
  const [lines, setLines] = useState<MetradoLine[]>([]);
  const [allPeriodLines, setAllPeriodLines] = useState<Map<string, MetradoLine[]>>(new Map());
  const [deductions, setDeductions] = useState<DeductionLine[]>([]);
  const [generating, setGenerating] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const project = projects.find((p) => p.id === projectId);
  const period = periods.find((p) => p.id === periodId);
  const items = useMemo(() => budgetItems.filter((b) => b.project_id === projectId), [budgetItems, projectId]);

  // Cargar períodos del proyecto
  useEffect(() => {
    if (!projectId) {
      setPeriods([]);
      return;
    }
    void supabase
      .from("valuation_periods")
      .select("*")
      .eq("project_id", projectId)
      .order("period_number")
      .then(({ data }) => setPeriods((data ?? []) as Period[]));
  }, [projectId]);

  // Cargar líneas y deducciones del período
  useEffect(() => {
    if (!periodId) return;
    void supabase
      .from("metrado_lines")
      .select("*")
      .eq("period_id", periodId)
      .order("sort_order")
      .then(({ data }) => setLines((data ?? []) as MetradoLine[]));
    void supabase
      .from("valuation_deductions")
      .select("*")
      .eq("period_id", periodId)
      .then(({ data }) => setDeductions((data ?? []) as DeductionLine[]));
  }, [periodId]);

  // Cargar líneas previas para cuadro acumulado
  useEffect(() => {
    if (!projectId || !period) return;
    const prevPeriods = periods.filter((p) => p.period_number < period.period_number);
    if (prevPeriods.length === 0) {
      setAllPeriodLines(new Map());
      return;
    }
    void supabase
      .from("metrado_lines")
      .select("*")
      .in("period_id", prevPeriods.map((p) => p.id))
      .then(({ data }) => {
        const m = new Map<string, MetradoLine[]>();
        for (const l of (data ?? []) as MetradoLine[]) {
          const arr = m.get(l.period_id ?? "") ?? [];
          arr.push(l);
          m.set(l.period_id ?? "", arr);
        }
        setAllPeriodLines(m);
      });
  }, [projectId, period, periods]);

  const previousLines = useMemo(() => {
    return Array.from(allPeriodLines.values()).flat();
  }, [allPeriodLines]);

  const valTable = useMemo(
    () => buildValuationTable({ items, currentLines: lines, previousLines }),
    [items, lines, previousLines],
  );
  const t = totals(valTable);
  const totalDeductions = deductions.reduce((a, d) => a + Number(d.amount || 0), 0);
  const netAmount = t.current - totalDeductions;
  const currency = project?.currency_code ?? "PEN";

  // -------- Acciones --------
  async function createPeriod(form: { number: number; from: string; to: string }): Promise<boolean> {
    if (!projectId || !user) return false;
    if (items.length === 0) {
      toast.error("Primero debes cargar presupuesto y partidas del proyecto.");
      return false;
    }

    // Validaciones de fechas
    const from = new Date(form.from);
    const to = new Date(form.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      toast.error("Fechas inválidas.");
      return false;
    }
    if (to < from) {
      toast.error("La fecha 'Hasta' debe ser mayor o igual a 'Desde'.");
      return false;
    }

    // Rango lógico del proyecto
    if (project?.start_date) {
      const ps = new Date(project.start_date);
      if (from < ps) {
        toast.error(`'Desde' no puede ser anterior al inicio del proyecto (${project.start_date}).`);
        return false;
      }
    }
    const projectEnd = project?.actual_end_date ?? project?.planned_end_date ?? project?.planned_completion_date ?? null;
    if (projectEnd) {
      const pe = new Date(projectEnd);
      // permitir 30 días de tolerancia más allá del fin planificado
      const tolerance = new Date(pe.getTime() + 30 * 86_400_000);
      if (to > tolerance) {
        toast.error(`'Hasta' excede el plazo del proyecto (fin: ${projectEnd}).`);
        return false;
      }
    }

    // Continuidad con valorización anterior
    const prev = periods
      .slice()
      .sort((a, b) => a.period_number - b.period_number)
      .filter((p) => p.period_number < form.number)
      .pop();
    if (prev) {
      const prevTo = new Date(prev.date_to);
      if (from <= prevTo) {
        toast.error(`'Desde' debe ser mayor que el fin de la valorización N° ${prev.period_number} (${prev.date_to}).`);
        return false;
      }
    }

    // Sin traslape con períodos existentes
    const overlap = periods.find((p) => {
      const a = new Date(p.date_from);
      const b = new Date(p.date_to);
      return from <= b && to >= a;
    });
    if (overlap) {
      toast.error(`El período se solapa con la valorización N° ${overlap.period_number} (${overlap.date_from} → ${overlap.date_to}).`);
      return false;
    }

    const { data, error } = await supabase
      .from("valuation_periods")
      .insert({
        project_id: projectId,
        period_number: form.number,
        date_from: form.from,
        date_to: form.to,
        created_by: user.id,
      })
      .select("*")
      .single();
    if (error) {
      toast.error(error.message);
      return false;
    }
    setPeriods((p) => [...p, data as Period]);
    setPeriodId(data!.id);
    toast.success("Período creado");
    return true;
  }

  async function saveNarrative(patch: Partial<Period>) {
    if (!periodId) return;
    setPeriods((ps) => ps.map((p) => (p.id === periodId ? { ...p, ...patch } : p)));
    await supabase.from("valuation_periods").update(patch).eq("id", periodId);
  }

  async function addDeduction() {
    if (!periodId || !projectId || !user) return;
    const { data, error } = await supabase
      .from("valuation_deductions")
      .insert({
        project_id: projectId,
        period_id: periodId,
        deduction_type: "otra",
        amount: 0,
        created_by: user.id,
      })
      .select("*")
      .single();
    if (error) return toast.error(error.message);
    setDeductions((d) => [...d, data as DeductionLine]);
  }

  async function updateDeduction(id: string, patch: Partial<DeductionLine>) {
    setDeductions((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    await supabase.from("valuation_deductions").update(patch as any).eq("id", id);
  }

  async function removeDeduction(id: string) {
    setDeductions((ds) => ds.filter((d) => d.id !== id));
    await supabase.from("valuation_deductions").delete().eq("id", id);
  }

  async function generatePdf() {
    if (!projectId || !periodId) {
      toast.error("Selecciona un proyecto y un período antes de generar.");
      return;
    }

    if (!project || !period) {
      toast.error("No se pudieron cargar el proyecto o el período seleccionado.");
      return;
    }

    setGenerating(true);
    setGenerationError(null);
    const tid = toast.loading("Generando memoria e informe técnico PDF...");

    try {
      const res = await generateExpedienteClientPdf({
        project,
        period,
        items,
        currentLines: lines,
        deductions,
        valTable,
        totals: t,
        totalDeductions,
        netAmount,
        currency,
      });

      toast.dismiss(tid);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      setLastUrl(res.url);
      toast.success("Memoria e informe técnico generados correctamente");

      const link = document.createElement("a");
      link.href = res.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.download = res.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e: any) {
      toast.dismiss(tid);
      const msg = e?.message ?? "Error desconocido al generar el PDF";
      console.error("[MemoriaInforme] generatePdf failed", e);
      setGenerationError(msg);
      toast.error(msg, { duration: 12000, style: { whiteSpace: "pre-line" } });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <PageLayout
      title="Memoria valorizada e Informe Técnico"
      description="Asistente para completar la ficha técnica y la memoria valorizada e informe técnico."
    >
      {/* Stepper */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(s.id)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              step === s.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            <span className="mr-1 font-bold">{s.id}.</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* Step 1: proyecto + período */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Proyecto y período de valorización</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Proyecto</Label>
              <Select value={projectId} onValueChange={(v) => { setProjectId(v); setPeriodId(""); }}>
                <SelectTrigger><SelectValue placeholder="Selecciona un proyecto..." /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {projectId && (
              <>
                {items.length === 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                      <div className="flex-1">
                        <p className="font-semibold">Primero debes cargar presupuesto y partidas del proyecto.</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          No es posible crear una valorización mensual sin partidas registradas.
                        </p>
                        <Button asChild size="sm" variant="outline" className="mt-2">
                          <Link to="/app/budgets">Ir a Presupuesto y partidas</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {items.length > 0 && (
                  <>
                    <div>
                      <Label>Períodos existentes</Label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {periods.length === 0 && <span className="text-sm text-muted-foreground">Sin períodos aún. Crea el primero abajo.</span>}
                        {periods.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setPeriodId(p.id)}
                            className={`rounded-md border px-3 py-2 text-left text-sm ${periodId === p.id ? "border-primary bg-primary/10" : "border-border"}`}
                          >
                            <div className="font-semibold">Valorización N° {String(p.period_number).padStart(2, "0")}</div>
                            <div className="text-xs text-muted-foreground">{p.date_from} → {p.date_to}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <NewPeriodForm
                      defaultNumber={(Math.max(0, ...periods.map((p) => p.period_number)) || 0) + 1}
                      previousPeriod={periods.slice().sort((a, b) => a.period_number - b.period_number).pop() ?? null}
                      projectStart={project?.start_date ?? null}
                      projectEnd={project?.actual_end_date ?? project?.planned_end_date ?? project?.planned_completion_date ?? null}
                      onCreate={createPeriod}
                    />
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Ficha técnica */}
      {step === 2 && project && (
        <Card>
          <CardHeader>
            <CardTitle>Ficha técnica del proyecto</CardTitle>
            <p className="text-xs text-muted-foreground">
              Datos generales que identifican la obra dentro de la memoria valorizada e informe técnico.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <FichaDato label="Entidad" value={project.entity_name} />
              <FichaDato label="Contratista" value={project.contractor_name} />
              <FichaDato label="Supervisor" value={project.supervisor_name} />
              <FichaDato label="Residente" value={project.resident_name} />
              <FichaDato label="Modalidad de ejecución" value={project.execution_modality} />
              <FichaDato label="Contrato de ejecución" value={project.execution_contract} />
              <FichaDato label="Contrato de supervisión" value={project.supervision_contract} />
              <FichaDato label="Monto contractual" value={formatMoney(Number(project.contract_amount || 0), currency)} />
            </div>
            {isFichaTecnicaIncomplete(project) && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                La ficha técnica está incompleta. Completa los datos generales del proyecto antes de generar el PDF.
                <Button asChild size="sm" variant="secondary" className="mt-3 block w-fit">
                  <Link to="/app/projects">Completar ficha técnica</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Memoria valorizada e informe técnico */}
      {step === 3 && period && project && (() => {
        const parentSet = buildParentCodeSet(valTable.map((r) => ({ item_code: r.item.item_code })));
        const summaryRows = valTable.filter((r) => r.qtyCurrent > 0 || lines.some((l) => l.item_id === r.item.id));
        const summaryTotal = summaryRows.reduce((s, r) => s + r.amountCurrent, 0);
        const baseTotal = valTable.reduce(
          (s, r) => s + (isLeafByCode(r.item.item_code, parentSet)
            ? Number(r.item.partial_amount || r.item.base_quantity * r.item.unit_price || 0)
            : 0),
          0,
        );
        const summaryHierarchy = buildSummaryHierarchy(valTable);
        const pctEjecutado = baseTotal > 0 ? (t.accum / baseTotal) * 100 : 0;
        const projectLocation = [project.district, project.province, project.department].filter(Boolean).join(", ") || "—";
        return (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Memoria valorizada e informe técnico — Valorización N° {String(period.period_number).padStart(2, "0")}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Documento narrativo del período {period.date_from} → {period.date_to}. Aquí solo se incluye el resumen consolidado; el sustento técnico se gestiona por separado en el módulo Metrados.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Datos generales rápidos (solo lectura) */}
                <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/20 p-3 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-[11px] uppercase text-muted-foreground">Proyecto</p>
                    <p className="font-medium">{project.code} — {project.name}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase text-muted-foreground">Ubicación</p>
                    <p className="font-medium">{projectLocation}</p>
                  </div>
                </div>

                {/* Narrativa */}
                <div>
                  <Label>Generalidades</Label>
                  <Textarea rows={3} defaultValue={period.generalidades ?? ""} onBlur={(e) => saveNarrative({ generalidades: e.target.value })} />
                </div>
                <div>
                  <Label>Metas del proyecto</Label>
                  <Textarea rows={3} defaultValue={period.metas ?? ""} onBlur={(e) => saveNarrative({ metas: e.target.value })} />
                </div>

                {/* Avance físico */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="text-[11px] uppercase text-muted-foreground">Avance físico ejecutado (acumulado)</p>
                    <p className="mt-1 text-xl font-semibold">{formatNum(pctEjecutado, 2)}%</p>
                    <p className="text-xs text-muted-foreground">Calculado automáticamente: {formatMoney(t.accum, currency)} de {formatMoney(baseTotal, currency)}.</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-[11px] uppercase text-muted-foreground">Avance físico programado (acumulado)</p>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Ej. 35.50"
                      defaultValue={period.resumen_ejecutivo ?? ""}
                      onBlur={(e) => saveNarrative({ resumen_ejecutivo: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Ingresa el % programado según cronograma.</p>
                  </div>
                </div>

                {/* Resumen y valorización a pagar */}
                <div className="rounded-md border bg-muted/10 p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Valorización a pagar (período actual, neto)</p>
                  <p className="mt-1 text-xl font-semibold">{formatMoney(netAmount, currency)}</p>
                  <p className="text-xs text-muted-foreground">
                    Bruto del período: {formatMoney(t.current, currency)} − Deducciones: {formatMoney(totalDeductions, currency)}.
                  </p>
                </div>

                <div>
                  <Label>Ocurrencias y desarrollo de la obra</Label>
                  <Textarea rows={4} defaultValue={period.ocurrencias ?? ""} onBlur={(e) => saveNarrative({ ocurrencias: e.target.value })} />
                </div>
                <div>
                  <Label>Conclusiones / observaciones del supervisor</Label>
                  <Textarea rows={3} defaultValue={period.conclusiones ?? ""} onBlur={(e) => saveNarrative({ conclusiones: e.target.value })} />
                </div>
              </CardContent>
            </Card>

            {/* Hoja resumen consolidada de metrados (solo lectura, sin planillas) */}
            <Card>
              <CardHeader>
                <CardTitle>Hoja resumen de metrados avanzados hasta la valorización</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Resumen consolidado de partidas ejecutadas. El detalle de metrados se registra por separado en el módulo Metrados.
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="w-[120px]">Partida</TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead className="w-[80px]">Und.</TableHead>
                        <TableHead className="w-[120px] text-right">TOTAL</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summaryHierarchy.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                          Aún no hay partidas ejecutadas. Regístralas en el módulo Metrados.
                        </TableCell></TableRow>
                      )}
                      {summaryHierarchy.map((r) => (
                        <TableRow key={r.key} className={r.isLeaf ? "" : "bg-muted/20"}>
                          <TableCell className="font-mono text-xs align-top">{r.code}</TableCell>
                          <TableCell
                            className={r.isLeaf ? "" : "font-semibold uppercase text-xs"}
                            style={{ paddingLeft: 8 + r.level * 16 }}
                          >
                            {r.description || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-xs">{r.isLeaf ? r.unit : ""}</TableCell>
                          <TableCell className="text-right font-mono">
                            {r.isLeaf && r.total != null ? formatNum(r.total, 2) : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* Step 4: deducciones */}
      {step === 4 && period && (
        <Card>
          <CardHeader>
            <CardTitle>Deducciones del período</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={addDeduction} size="sm"><Plus className="mr-1 h-4 w-4" /> Agregar deducción</Button>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Tipo</TableHead><TableHead>Descripción</TableHead><TableHead className="w-[160px] text-right">Monto</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {deductions.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Select value={d.deduction_type} onValueChange={(v) => updateDeduction(d.id, { deduction_type: v as any })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(deductionLabels).map(([k, lbl]) => (
                            <SelectItem key={k} value={k}>{lbl}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input className="h-8" defaultValue={d.description ?? ""} onBlur={(e) => updateDeduction(d.id, { description: e.target.value })} /></TableCell>
                    <TableCell><Input className="h-8 text-right" type="number" defaultValue={d.amount} onBlur={(e) => updateDeduction(d.id, { amount: Number(e.target.value) })} /></TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => removeDeduction(d.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
                {deductions.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sin deducciones.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <div className="flex justify-end text-sm">
              <span className="font-semibold">Total deducciones: {formatMoney(totalDeductions, currency)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5: resumen + PDF */}
      {step === 5 && period && project && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Resumen de Memoria valorizada e Informe Técnico</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <Stat label="Acumulado anterior" value={formatMoney(t.prev, currency)} />
                <Stat label="Período actual (bruto)" value={formatMoney(t.current, currency)} />
                <Stat label="Acumulado a la fecha" value={formatMoney(t.accum, currency)} />
                <Stat label="Saldo por valorizar" value={formatMoney(t.balance, currency)} />
                <Stat label="Total deducciones" value={formatMoney(totalDeductions, currency)} />
                <Stat label="MONTO NETO A PAGAR" value={formatMoney(netAmount, currency)} highlight />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                {generationError ? (
                  <span className="whitespace-pre-line text-destructive">{generationError}</span>
                ) : isFichaTecnicaIncomplete(project) ? (
                  <span className="text-destructive">
                    La ficha técnica del proyecto está incompleta. Complétala antes de generar la memoria e informe técnico.
                  </span>
                ) : (
                  <span>Ficha técnica completa. Listo para generar la memoria e informe técnico.</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {isFichaTecnicaIncomplete(project) && (
                  <Button variant="secondary" asChild>
                    <Link to="/app/projects">Completar ficha técnica</Link>
                  </Button>
                )}
                {lastUrl && (
                  <Button variant="outline" asChild>
                    <a href={lastUrl} target="_blank" rel="noreferrer"><Download className="mr-1 h-4 w-4" />Descargar último</a>
                  </Button>
                )}
                <Button onClick={generatePdf} disabled={generating || isFichaTecnicaIncomplete(project)}>
                  {generating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}
                  {generating ? "Generando memoria e informe..." : "Generar Memoria e Informe PDF"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Nav */}
      <div className="mt-6 flex justify-between">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Anterior
        </Button>
        <Button
          onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}
          disabled={
            step === STEPS.length ||
            (step === 1 && (!periodId || items.length === 0))
          }
        >
          Siguiente <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </PageLayout>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "border-primary bg-primary/10" : ""}`}>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

function FichaDato({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{String(value || "—")}</p>
    </div>
  );
}

function NewPeriodForm({
  defaultNumber,
  previousPeriod,
  projectStart,
  projectEnd,
  onCreate,
}: {
  defaultNumber: number;
  previousPeriod: Period | null;
  projectStart: string | null;
  projectEnd: string | null;
  onCreate: (f: { number: number; from: string; to: string }) => Promise<boolean>;
}) {
  const [number, setNumber] = useState(defaultNumber);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Autocompletar en función de valorización anterior
  useEffect(() => {
    setNumber(defaultNumber);
    if (touched) return;
    let suggestedFrom = "";
    if (previousPeriod?.date_to) {
      const d = new Date(previousPeriod.date_to);
      d.setDate(d.getDate() + 1);
      suggestedFrom = d.toISOString().slice(0, 10);
    } else if (projectStart) {
      suggestedFrom = projectStart;
    }
    if (suggestedFrom) {
      setFrom(suggestedFrom);
      // sugerir fin de mes natural a partir de "from"
      const f = new Date(suggestedFrom);
      const endOfMonth = new Date(f.getFullYear(), f.getMonth() + 1, 0);
      setTo(endOfMonth.toISOString().slice(0, 10));
    }
  }, [defaultNumber, previousPeriod, projectStart, touched]);

  // Validación inline
  const validation = (() => {
    if (!from || !to) return { ok: false, msg: "Completa ambas fechas." };
    const f = new Date(from);
    const t = new Date(to);
    if (t < f) return { ok: false, msg: "'Hasta' debe ser ≥ 'Desde'." };
    if (previousPeriod) {
      const pt = new Date(previousPeriod.date_to);
      if (f <= pt) return { ok: false, msg: `'Desde' debe ser posterior al ${previousPeriod.date_to}.` };
    }
    if (projectStart && f < new Date(projectStart)) {
      return { ok: false, msg: `'Desde' no puede ser anterior al inicio del proyecto (${projectStart}).` };
    }
    if (projectEnd) {
      const pe = new Date(projectEnd);
      const tolerance = new Date(pe.getTime() + 30 * 86_400_000);
      if (t > tolerance) return { ok: false, msg: `'Hasta' excede el plazo del proyecto (fin: ${projectEnd}).` };
    }
    return { ok: true as const, msg: "" };
  })();

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="mb-2 text-sm font-semibold">
        {previousPeriod ? "Nueva valorización (continuación)" : "Primera valorización del proyecto"}
      </p>
      {previousPeriod && (
        <p className="mb-2 text-xs text-muted-foreground">
          La valorización anterior (N° {previousPeriod.period_number}) terminó el {previousPeriod.date_to}.
          Se sugiere iniciar al día siguiente.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <Label className="text-xs">N°</Label>
          <Input type="number" value={number} onChange={(e) => setNumber(Number(e.target.value))} />
        </div>
        <div>
          <Label className="text-xs">Desde</Label>
          <Input type="date" value={from} onChange={(e) => { setTouched(true); setFrom(e.target.value); }} />
        </div>
        <div>
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={to} onChange={(e) => { setTouched(true); setTo(e.target.value); }} />
        </div>
        <div className="flex items-end">
          <Button
            className="w-full"
            disabled={!validation.ok || submitting}
            onClick={async () => {
              setSubmitting(true);
              const ok = await onCreate({ number, from, to });
              setSubmitting(false);
              if (ok) {
                setTouched(false);
                setFrom("");
                setTo("");
              }
            }}
          >
            <Plus className="mr-1 h-4 w-4" />Crear
          </Button>
        </div>
      </div>
      {!validation.ok && (from || to) && (
        <p className="mt-2 text-xs text-destructive">{validation.msg}</p>
      )}
    </div>
  );
}
