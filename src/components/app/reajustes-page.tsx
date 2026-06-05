import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Calculator, Plus, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/components/app/workspace-provider";
import { AuthGuard } from "@/components/app/auth-guard";
import { PageLayout } from "@/components/app/page-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Monomio {
  symbol: string;
  coefficient: number;
  index_code: string;
  base_index_value: number;
}

interface Formula {
  id: string;
  project_id: string;
  name: string;
  base_period_month: string;
  monomios: Monomio[];
  created_by: string;
}

interface IneiIndex {
  id: string;
  period_month: string;
  code: string;
  description: string | null;
  value: number;
}

interface Reajuste {
  id: string;
  project_id: string;
  formula_id: string;
  period_month: string;
  base_amount: number;
  k_value: number;
  reajuste_amount: number;
  valuation_id: string | null;
  detail: any;
  created_at: string;
}

function formatMoney(n: number) {
  return n.toLocaleString("es-PE", { style: "currency", currency: "PEN" });
}

export function ReajustesPage() {
  const { projects, valuations } = useWorkspace();
  const { user, isAdmin } = useAuth();
  const [projectId, setProjectId] = useState("");
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [indices, setIndices] = useState<IneiIndex[]>([]);
  const [reajustes, setReajustes] = useState<Reajuste[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (projects.length > 0 && !projectId) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const loadData = async () => {
    if (!projectId) return;
    setLoading(true);
    const [f, i, r] = await Promise.all([
      supabase.from("polynomial_formulas").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("inei_indices").select("*").order("period_month", { ascending: false }).limit(500),
      supabase.from("reajustes").select("*").eq("project_id", projectId).order("period_month", { ascending: false }),
    ]);
    if (f.error) toast.error(f.error.message);
    else setFormulas((f.data ?? []).map((x: any) => ({ ...x, monomios: Array.isArray(x.monomios) ? x.monomios : [] })));
    if (i.error) toast.error(i.error.message);
    else setIndices(i.data ?? []);
    if (r.error) toast.error(r.error.message);
    else setReajustes(r.data ?? []);
    setLoading(false);
  };

  useEffect(() => { void loadData(); }, [projectId]);

  return (
    <AuthGuard>
      <PageLayout
        title="Reajustes (Fórmula polinómica)"
        description="Calcula reajustes de precios mediante fórmula polinómica con índices unificados del INEI."
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Proyecto</CardTitle>
            <CardDescription>Selecciona el proyecto sobre el que trabajarás.</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="max-w-md"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {projectId ? (
          <Tabs defaultValue="calc" className="space-y-4">
            <TabsList>
              <TabsTrigger value="calc">Cálculos</TabsTrigger>
              <TabsTrigger value="formulas">Fórmulas</TabsTrigger>
              <TabsTrigger value="indices">Índices INEI</TabsTrigger>
            </TabsList>

            <TabsContent value="calc">
              <CalcTab
                projectId={projectId}
                formulas={formulas}
                indices={indices}
                reajustes={reajustes}
                valuations={valuations.filter((v) => v.project_id === projectId)}
                userId={user?.id}
                onChange={loadData}
              />
            </TabsContent>

            <TabsContent value="formulas">
              <FormulasTab
                projectId={projectId}
                formulas={formulas}
                userId={user?.id}
                onChange={loadData}
              />
            </TabsContent>

            <TabsContent value="indices">
              <IndicesTab indices={indices} isAdmin={isAdmin} onChange={loadData} />
            </TabsContent>
          </Tabs>
        ) : null}

        {loading ? <p className="text-xs text-muted-foreground">Cargando…</p> : null}
      </PageLayout>
    </AuthGuard>
  );
}

// ============== CÁLCULO ==============
function CalcTab({
  projectId,
  formulas,
  indices,
  reajustes,
  userId,
  onChange,
}: {
  projectId: string;
  formulas: Formula[];
  indices: IneiIndex[];
  reajustes: Reajuste[];
  userId: string | undefined;
  onChange: () => Promise<void>;
}) {
  const [formulaId, setFormulaId] = useState("");
  const [periodMonth, setPeriodMonth] = useState("");
  const [baseAmount, setBaseAmount] = useState("0");
  const [saving, setSaving] = useState(false);

  const formula = formulas.find((f) => f.id === formulaId);

  const calc = useMemo(() => {
    if (!formula || !periodMonth) return null;
    // Indices for selected period
    const monthIdx = indices.filter((i) => i.period_month === periodMonth);
    const detail: Array<{ symbol: string; coeff: number; Ii: number; Ioi: number; ratio: number; term: number; missing?: boolean }> = [];
    let k = 0;
    let totalCoeff = 0;
    for (const m of formula.monomios) {
      const Ii = monthIdx.find((x) => x.code === m.index_code)?.value;
      const Ioi = Number(m.base_index_value);
      const coeff = Number(m.coefficient);
      totalCoeff += coeff;
      if (Ii == null || !Ioi) {
        detail.push({ symbol: m.symbol, coeff, Ii: 0, Ioi, ratio: 0, term: 0, missing: true });
        continue;
      }
      const ratio = Number(Ii) / Ioi;
      const term = coeff * ratio;
      k += term;
      detail.push({ symbol: m.symbol, coeff, Ii: Number(Ii), Ioi, ratio, term });
    }
    const base = Number(baseAmount) || 0;
    const reajuste = base * (k - 1);
    return { k, detail, reajuste, base, totalCoeff };
  }, [formula, periodMonth, indices, baseAmount]);

  const save = async () => {
    if (!userId || !formula || !calc) return;
    setSaving(true);
    const { error } = await supabase.from("reajustes").insert({
      project_id: projectId,
      formula_id: formula.id,
      period_month: periodMonth,
      base_amount: calc.base,
      k_value: calc.k,
      reajuste_amount: calc.reajuste,
      detail: { monomios: calc.detail },
      created_by: userId,
    });
    setSaving(false);
    if (error) {
      toast.error("No se pudo registrar", { description: error.message });
      return;
    }
    toast.success("Reajuste registrado");
    await onChange();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calcular K y monto de reajuste</CardTitle>
          <CardDescription>K = Σ (coef × Ii / Ioi). Reajuste = Monto base × (K − 1).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Fórmula</Label>
              <Select value={formulaId} onValueChange={setFormulaId}>
                <SelectTrigger><SelectValue placeholder="Selecciona fórmula…" /></SelectTrigger>
                <SelectContent>
                  {formulas.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mes del índice (Ii)</Label>
              <Input type="month" value={periodMonth ? periodMonth.slice(0, 7) : ""} onChange={(e) => setPeriodMonth(e.target.value ? `${e.target.value}-01` : "")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Monto base (valorización bruta)</Label>
              <Input type="number" step="0.01" value={baseAmount} onChange={(e) => setBaseAmount(e.target.value)} />
            </div>
          </div>

          {calc ? (
            <div className="space-y-3 rounded-md border p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Monomio</TableHead>
                    <TableHead>Coef.</TableHead>
                    <TableHead>Ii</TableHead>
                    <TableHead>Ioi</TableHead>
                    <TableHead>Ii/Ioi</TableHead>
                    <TableHead>Término</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calc.detail.map((d, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{d.symbol} {d.missing ? <Badge variant="destructive" className="ml-1">índice faltante</Badge> : null}</TableCell>
                      <TableCell>{d.coeff.toFixed(3)}</TableCell>
                      <TableCell>{d.Ii.toFixed(2)}</TableCell>
                      <TableCell>{d.Ioi.toFixed(2)}</TableCell>
                      <TableCell>{d.ratio.toFixed(4)}</TableCell>
                      <TableCell>{d.term.toFixed(4)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap gap-4 text-sm">
                <div>Σ coeficientes: <strong>{calc.totalCoeff.toFixed(3)}</strong></div>
                <div>K: <strong>{calc.k.toFixed(6)}</strong></div>
                <div>Reajuste: <strong>{formatMoney(calc.reajuste)}</strong></div>
              </div>
              {Math.abs(calc.totalCoeff - 1) > 0.001 ? (
                <p className="text-xs text-destructive">Advertencia: la suma de coeficientes debe ser 1.000.</p>
              ) : null}
              <Button onClick={save} disabled={saving || !formula || !periodMonth}>
                <Calculator className="mr-1 h-4 w-4" /> {saving ? "Guardando…" : "Registrar reajuste"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Historial de reajustes</CardTitle></CardHeader>
        <CardContent>
          {reajustes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cálculos registrados.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead>Fórmula</TableHead>
                  <TableHead>Base</TableHead>
                  <TableHead>K</TableHead>
                  <TableHead>Reajuste</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reajustes.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.period_month}</TableCell>
                    <TableCell>{formulas.find((f) => f.id === r.formula_id)?.name ?? "—"}</TableCell>
                    <TableCell>{formatMoney(Number(r.base_amount))}</TableCell>
                    <TableCell>{Number(r.k_value).toFixed(6)}</TableCell>
                    <TableCell>{formatMoney(Number(r.reajuste_amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============== FÓRMULAS ==============
function FormulasTab({
  projectId,
  formulas,
  userId,
  onChange,
}: {
  projectId: string;
  formulas: Formula[];
  userId: string | undefined;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [basePeriod, setBasePeriod] = useState("");
  const [monomios, setMonomios] = useState<Monomio[]>([
    { symbol: "a", coefficient: 0.3, index_code: "39", base_index_value: 100 },
  ]);
  const [saving, setSaving] = useState(false);

  const addMon = () => setMonomios((m) => [...m, { symbol: "", coefficient: 0, index_code: "", base_index_value: 0 }]);
  const updMon = (i: number, patch: Partial<Monomio>) =>
    setMonomios((arr) => arr.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const rmMon = (i: number) => setMonomios((arr) => arr.filter((_, idx) => idx !== i));

  const total = monomios.reduce((s, m) => s + Number(m.coefficient || 0), 0);

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase.from("polynomial_formulas").insert({
      project_id: projectId,
      name,
      base_period_month: basePeriod,
      monomios: monomios as any,
      created_by: userId,
    });
    setSaving(false);
    if (error) {
      toast.error("No se pudo guardar", { description: error.message });
      return;
    }
    toast.success("Fórmula guardada");
    setOpen(false);
    setName(""); setBasePeriod("");
    setMonomios([{ symbol: "a", coefficient: 0.3, index_code: "39", base_index_value: 100 }]);
    await onChange();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("polynomial_formulas").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Fórmula eliminada"); await onChange(); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Fórmulas polinómicas</CardTitle>
          <CardDescription>Cada monomio = símbolo · coeficiente · índice INEI · valor base (Ioi).</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" /> Nueva fórmula</Button></DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nueva fórmula polinómica</DialogTitle>
              <DialogDescription>Define los monomios. La suma de coeficientes debe ser 1.000.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Nombre</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="K1 - Obra civil" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Mes base (Ioi)</Label>
                  <Input type="month" value={basePeriod ? basePeriod.slice(0, 7) : ""} onChange={(e) => setBasePeriod(e.target.value ? `${e.target.value}-01` : "")} />
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Símbolo</TableHead>
                    <TableHead>Coef.</TableHead>
                    <TableHead>Cód. índice</TableHead>
                    <TableHead>Ioi (valor base)</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monomios.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell><Input value={m.symbol} onChange={(e) => updMon(i, { symbol: e.target.value })} /></TableCell>
                      <TableCell><Input type="number" step="0.001" value={m.coefficient} onChange={(e) => updMon(i, { coefficient: Number(e.target.value) })} /></TableCell>
                      <TableCell><Input value={m.index_code} onChange={(e) => updMon(i, { index_code: e.target.value })} placeholder="39" /></TableCell>
                      <TableCell><Input type="number" step="0.0001" value={m.base_index_value} onChange={(e) => updMon(i, { base_index_value: Number(e.target.value) })} /></TableCell>
                      <TableCell><Button variant="ghost" size="icon" onClick={() => rmMon(i)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={addMon}><Plus className="mr-1 h-4 w-4" /> Agregar monomio</Button>
                <span className={`text-xs ${Math.abs(total - 1) > 0.001 ? "text-destructive" : "text-muted-foreground"}`}>Σ = {total.toFixed(3)}</span>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={save} disabled={saving || !name || !basePeriod}>{saving ? "Guardando…" : "Guardar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {formulas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin fórmulas todavía.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Nombre</TableHead><TableHead>Mes base</TableHead><TableHead>Monomios</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {formulas.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell>{f.base_period_month}</TableCell>
                  <TableCell className="text-xs">{f.monomios.map((m) => `${m.symbol}=${m.coefficient}·I${m.index_code}`).join(" + ")}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => remove(f.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ============== ÍNDICES INEI ==============
function IndicesTab({ indices, isAdmin, onChange }: { indices: IneiIndex[]; isAdmin: boolean; onChange: () => Promise<void> }) {
  const [period, setPeriod] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterPeriod, setFilterPeriod] = useState("");

  const filtered = filterPeriod ? indices.filter((i) => i.period_month === filterPeriod) : indices;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("inei_indices").upsert({
      period_month: period,
      code,
      description: description || null,
      value: Number(value),
    }, { onConflict: "period_month,code" });
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Índice guardado"); setCode(""); setDescription(""); setValue(""); await onChange(); }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("inei_indices").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Eliminado"); await onChange(); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Índices unificados INEI</CardTitle>
        <CardDescription>{isAdmin ? "Solo administradores globales pueden modificar." : "Consulta del catálogo INEI."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin ? (
          <div className="grid gap-3 rounded-md border p-3 md:grid-cols-5">
            <div className="space-y-1">
              <Label className="text-xs">Mes</Label>
              <Input type="month" value={period ? period.slice(0, 7) : ""} onChange={(e) => setPeriod(e.target.value ? `${e.target.value}-01` : "")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Código</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="39" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Descripción</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Valor</Label>
              <Input type="number" step="0.0001" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="md:col-span-5">
              <Button onClick={save} disabled={saving || !period || !code || !value}>{saving ? "Guardando…" : "Agregar / actualizar"}</Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-1">
          <Label className="text-xs">Filtrar por mes</Label>
          <Input type="month" value={filterPeriod ? filterPeriod.slice(0, 7) : ""} onChange={(e) => setFilterPeriod(e.target.value ? `${e.target.value}-01` : "")} className="max-w-xs" />
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin índices.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Mes</TableHead><TableHead>Código</TableHead><TableHead>Descripción</TableHead><TableHead>Valor</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.period_month}</TableCell>
                  <TableCell>{i.code}</TableCell>
                  <TableCell>{i.description || "—"}</TableCell>
                  <TableCell>{Number(i.value).toFixed(4)}</TableCell>
                  <TableCell>{isAdmin ? <Button variant="ghost" size="icon" onClick={() => remove(i.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
