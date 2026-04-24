import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, Download, FileDown, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageLayout } from "@/components/app/page-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/components/app/workspace-provider";
import { isFichaTecnicaIncomplete } from "@/components/app/workspace-pages";
import { useAuth } from "@/lib/auth";
import {
  buildValuationTable,
  computeLinePartial,
  deductionLabels,
  formatMoney,
  formatNum,
  totals,
  type DeductionLine,
  type MetradoLine,
} from "@/lib/expediente";
import { generateExpediente } from "@/lib/expediente-pdf.functions";

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
};

const STEPS = [
  { id: 1, label: "Proyecto y período" },
  { id: 2, label: "Metrados detallados" },
  { id: 3, label: "Narrativa técnica" },
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

  const generateFn = useServerFn(generateExpediente);

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
  async function createPeriod(form: { number: number; from: string; to: string }) {
    if (!projectId || !user) return;
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
      return;
    }
    setPeriods((p) => [...p, data as Period]);
    setPeriodId(data!.id);
    toast.success("Período creado");
  }

  async function addLine(itemId: string) {
    if (!periodId || !projectId || !user) return;
    const partial = computeLinePartial({ num_elements: 1 });
    const { data, error } = await supabase
      .from("metrado_lines")
      .insert({
        project_id: projectId,
        period_id: periodId,
        item_id: itemId,
        num_elements: 1,
        partial,
        sort_order: lines.length,
        created_by: user.id,
      })
      .select("*")
      .single();
    if (error) return toast.error(error.message);
    setLines((l) => [...l, data as MetradoLine]);
  }

  async function updateLine(id: string, patch: Partial<MetradoLine>) {
    const updated = lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
    const target = updated.find((l) => l.id === id)!;
    const partial = computeLinePartial(target);
    const final = { ...target, partial };
    setLines(updated.map((l) => (l.id === id ? final : l)));
    await supabase.from("metrado_lines").update({ ...patch, partial }).eq("id", id);
  }

  async function removeLine(id: string) {
    setLines((l) => l.filter((x) => x.id !== id));
    await supabase.from("metrado_lines").delete().eq("id", id);
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
    if (!projectId || !periodId) return;
    setGenerating(true);
    try {
      const res = await generateFn({ data: { projectId, periodId } });
      setLastUrl(res.signedUrl);
      toast.success("Expediente generado");
      if (res.signedUrl) window.open(res.signedUrl, "_blank");
    } catch (e: any) {
      toast.error(e.message ?? "Error al generar PDF");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <PageLayout
      title="Expediente Mensual"
      description="Asistente para generar el expediente mensual de supervisión / valorización."
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
                <div>
                  <Label>Períodos existentes</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {periods.length === 0 && <span className="text-sm text-muted-foreground">Sin períodos aún.</span>}
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
                  onCreate={createPeriod}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: metrados detallados */}
      {step === 2 && period && (
        <Card>
          <CardHeader>
            <CardTitle>Metrados detallados — Valorización N° {period.period_number}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label>Agregar línea para partida</Label>
                <Select onValueChange={(v) => addLine(v)}>
                  <SelectTrigger><SelectValue placeholder="Elige partida..." /></SelectTrigger>
                  <SelectContent>
                    {items.map((it) => (
                      <SelectItem key={it.id} value={it.id}>{it.item_code} — {it.description}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partida</TableHead>
                    <TableHead>Ubicación</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="w-[60px]">N°</TableHead>
                    <TableHead className="w-[80px]">Largo</TableHead>
                    <TableHead className="w-[80px]">Ancho</TableHead>
                    <TableHead className="w-[80px]">Alto</TableHead>
                    <TableHead className="w-[100px]">Fórmula</TableHead>
                    <TableHead className="w-[100px] text-right">Parcial</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => {
                    const it = items.find((i) => i.id === l.item_id);
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs">{it?.item_code} — {it?.unit}</TableCell>
                        <TableCell><Input className="h-8" defaultValue={l.group_label ?? ""} onBlur={(e) => updateLine(l.id, { group_label: e.target.value })} placeholder="Calle / tramo" /></TableCell>
                        <TableCell><Input className="h-8" defaultValue={l.description ?? ""} onBlur={(e) => updateLine(l.id, { description: e.target.value })} /></TableCell>
                        <TableCell><Input className="h-8" type="number" defaultValue={l.num_elements ?? 1} onBlur={(e) => updateLine(l.id, { num_elements: Number(e.target.value) })} /></TableCell>
                        <TableCell><Input className="h-8" type="number" defaultValue={l.length ?? ""} onBlur={(e) => updateLine(l.id, { length: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
                        <TableCell><Input className="h-8" type="number" defaultValue={l.width ?? ""} onBlur={(e) => updateLine(l.id, { width: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
                        <TableCell><Input className="h-8" type="number" defaultValue={l.height ?? ""} onBlur={(e) => updateLine(l.id, { height: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
                        <TableCell><Input className="h-8" defaultValue={l.formula ?? ""} placeholder="L*A*H*N" onBlur={(e) => updateLine(l.id, { formula: e.target.value || null })} /></TableCell>
                        <TableCell className="text-right font-mono">{formatNum(Number(l.partial), 2)}</TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(l.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    );
                  })}
                  {lines.length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">Sin metrados aún. Agrega una línea seleccionando una partida.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Hoja resumen de metrados (período actual)</p>
              <div className="grid grid-cols-1 gap-1 text-xs md:grid-cols-2">
                {valTable.filter((r) => r.qtyCurrent > 0).map((r) => (
                  <div key={r.item.id} className="flex justify-between border-b py-1">
                    <span className="truncate">{r.item.item_code} {r.item.description}</span>
                    <span className="font-mono">{formatNum(r.qtyCurrent, 2)} {r.item.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: narrativa */}
      {step === 3 && period && (
        <Card>
          <CardHeader><CardTitle>Narrativa técnica del período</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: "generalidades" as const, label: "Generalidades" },
              { key: "metas" as const, label: "Metas del proyecto" },
              { key: "ocurrencias" as const, label: "Ocurrencias y desarrollo de la obra" },
              { key: "conclusiones" as const, label: "Conclusiones / observaciones del supervisor" },
            ].map((f) => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Textarea
                  rows={4}
                  defaultValue={period[f.key] ?? ""}
                  onBlur={(e) => saveNarrative({ [f.key]: e.target.value } as any)}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
            <CardHeader><CardTitle>Resumen de valorización</CardTitle></CardHeader>
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
            <CardHeader><CardTitle>Cuadro de valorización por partida</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Ítem</TableHead><TableHead>Descripción</TableHead><TableHead>Und</TableHead>
                  <TableHead className="text-right">Met. base</TableHead>
                  <TableHead className="text-right">Ant.</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Acum.</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">% Acum</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {valTable.map((r) => (
                    <TableRow key={r.item.id}>
                      <TableCell className="text-xs">{r.item.item_code}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs">{r.item.description}</TableCell>
                      <TableCell className="text-xs">{r.item.unit}</TableCell>
                      <TableCell className="text-right text-xs">{formatNum(Number(r.item.base_quantity), 2)}</TableCell>
                      <TableCell className="text-right text-xs">{formatNum(r.qtyPrev, 2)}</TableCell>
                      <TableCell className="text-right text-xs font-semibold">{formatNum(r.qtyCurrent, 2)}</TableCell>
                      <TableCell className="text-right text-xs">{formatNum(r.qtyAccum, 2)}</TableCell>
                      <TableCell className="text-right text-xs">{formatNum(r.qtyBalance, 2)}</TableCell>
                      <TableCell className="text-right text-xs"><Badge variant="outline">{formatNum(r.pctAccum, 1)}%</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                {isFichaTecnicaIncomplete(project) ? (
                  <span className="text-destructive">
                    La ficha técnica del proyecto está incompleta. Complétala antes de generar el expediente.
                  </span>
                ) : (
                  <span>Ficha técnica completa. Listo para generar el expediente.</span>
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
                  Generar Expediente PDF
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
        <Button onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))} disabled={step === STEPS.length || (step === 1 && !periodId)}>
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

function NewPeriodForm({ defaultNumber, onCreate }: { defaultNumber: number; onCreate: (f: { number: number; from: string; to: string }) => void }) {
  const [number, setNumber] = useState(defaultNumber);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => setNumber(defaultNumber), [defaultNumber]);
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="mb-2 text-sm font-semibold">Nueva valorización</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div><Label className="text-xs">N°</Label><Input type="number" value={number} onChange={(e) => setNumber(Number(e.target.value))} /></div>
        <div><Label className="text-xs">Desde</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">Hasta</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex items-end"><Button className="w-full" disabled={!from || !to} onClick={() => onCreate({ number, from, to })}><Plus className="mr-1 h-4 w-4" />Crear</Button></div>
      </div>
    </div>
  );
}
