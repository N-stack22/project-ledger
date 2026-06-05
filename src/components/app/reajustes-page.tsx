import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Calculator, Plus, Trash2, Upload, Download } from "lucide-react";

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
  valuations,
  userId,
  onChange,
}: {
  projectId: string;
  formulas: Formula[];
  indices: IneiIndex[];
  reajustes: Reajuste[];
  valuations: Array<{ id: string; period_month: string; gross_amount: number; status: string }>;
  userId: string | undefined;
  onChange: () => Promise<void>;
}) {
  const [formulaId, setFormulaId] = useState("");
  const [periodMonth, setPeriodMonth] = useState("");
  const [baseAmount, setBaseAmount] = useState("0");
  const [valuationId, setValuationId] = useState<string>("none");
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
      valuation_id: valuationId !== "none" ? valuationId : null,
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
            <div className="space-y-1 md:col-span-3">
              <Label className="text-xs">Vincular a valorización (opcional)</Label>
              <Select
                value={valuationId}
                onValueChange={(v) => {
                  setValuationId(v);
                  if (v !== "none") {
                    const val = valuations.find((x) => x.id === v);
                    if (val) {
                      setPeriodMonth(val.period_month);
                      setBaseAmount(String(val.gross_amount ?? 0));
                    }
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Sin vincular" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin vincular</SelectItem>
                  {valuations.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.period_month} · Bruto {formatMoney(Number(v.gross_amount))} · {v.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  <TableHead>Vinculada</TableHead>
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
                    <TableCell>
                      {r.valuation_id
                        ? <Badge variant="secondary">Valorización</Badge>
                        : <Badge variant="outline">—</Badge>}
                    </TableCell>
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

function downloadIneiTemplate() {
  const lines = [
    "# Plantilla de Índices Unificados INEI",
    "# Columnas obligatorias: code, value",
    "# Columnas opcionales: period_month (YYYY-MM-DD o YYYY-MM), description",
    "# Si omites period_month, indica el mes por defecto en el diálogo de importación.",
    "# El separador puede ser coma (,) o punto y coma (;).",
    "# Decimales con punto (128.45). Filas con (mes, código) duplicado actualizan el valor.",
    "period_month,code,description,value",
    "2026-06-01,39,Indice de mano de obra,128.45",
    "2026-06-01,47,Cemento Portland tipo I,142.10",
    "2026-06-01,48,Acero de construcción,156.30",
    "2026-06-01,49,Madera para construcción,134.20",
    "",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla-indices-inei.csv";
  a.click();
  URL.revokeObjectURL(url);
}


interface ParsedRow {
  period_month: string;
  code: string;
  description: string | null;
  value: number;
  __line: number;
  __error?: string;
}

function normalizePeriod(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}$/.test(v)) return `${v}-01`;
  const m1 = v.match(/^(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?$/);
  if (m1) {
    const y = m1[1];
    const mo = m1[2].padStart(2, "0");
    const d = (m1[3] ?? "01").padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  const m2 = v.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m2) return `${m2[2]}-${m2[1].padStart(2, "0")}-01`;
  return null;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === sep) { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function parseIndicesCsv(text: string, fallbackPeriod: string | null): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = [];
  const matrix = parseCsv(text);
  if (matrix.length === 0) return { rows: [], errors: ["El archivo está vacío."] };

  const header = matrix[0].map((h) => h.trim().toLowerCase());
  const idx = {
    period: header.findIndex((h) => ["period", "period_month", "mes", "periodo", "fecha"].includes(h)),
    code: header.findIndex((h) => ["code", "codigo", "código", "cod", "indice", "índice"].includes(h)),
    description: header.findIndex((h) => ["description", "descripcion", "descripción", "nombre"].includes(h)),
    value: header.findIndex((h) => ["value", "valor", "ip", "indice_valor"].includes(h)),
  };

  if (idx.code === -1 || idx.value === -1) {
    errors.push("El CSV debe tener al menos las columnas 'code' y 'value' (también acepta 'codigo' y 'valor').");
    return { rows: [], errors };
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i];
    const lineNum = i + 1;
    const rawPeriod = idx.period >= 0 ? r[idx.period]?.trim() ?? "" : "";
    const period = rawPeriod ? normalizePeriod(rawPeriod) : fallbackPeriod;
    const code = r[idx.code]?.trim() ?? "";
    const valueRaw = (r[idx.value] ?? "").trim().replace(",", ".");
    const description = idx.description >= 0 ? (r[idx.description]?.trim() || null) : null;

    if (!period) { rows.push({ period_month: "", code, description, value: 0, __line: lineNum, __error: "Mes inválido o ausente" }); continue; }
    if (!code) { rows.push({ period_month: period, code: "", description, value: 0, __line: lineNum, __error: "Código vacío" }); continue; }
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) { rows.push({ period_month: period, code, description, value: 0, __line: lineNum, __error: `Valor no numérico: "${valueRaw}"` }); continue; }
    rows.push({ period_month: period, code, description, value, __line: lineNum });
  }

  return { rows, errors };
}

function ImportCsvDialog({ onChange }: { onChange: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [fallbackPeriod, setFallbackPeriod] = useState("");
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setParsed(null); setErrors([]); setFileName(""); setFallbackPeriod("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const { rows, errors } = parseIndicesCsv(text, fallbackPeriod || null);
    setParsed(rows);
    setErrors(errors);
  };

  const reparseWithPeriod = (p: string) => {
    setFallbackPeriod(p);
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const { rows, errors } = parseIndicesCsv(text, p || null);
      setParsed(rows); setErrors(errors);
    });
  };

  const valid = (parsed ?? []).filter((r) => !r.__error);
  const invalid = (parsed ?? []).filter((r) => r.__error);

  const submit = async () => {
    if (valid.length === 0) return;
    setSaving(true);
    const chunkSize = 500;
    let ok = 0; let fail = 0; let firstErr: string | null = null;
    for (let i = 0; i < valid.length; i += chunkSize) {
      const slice = valid.slice(i, i + chunkSize).map((r) => ({
        period_month: r.period_month,
        code: r.code,
        description: r.description,
        value: r.value,
      }));
      const { error } = await supabase.from("inei_indices").upsert(slice, { onConflict: "period_month,code" });
      if (error) { fail += slice.length; if (!firstErr) firstErr = error.message; }
      else ok += slice.length;
    }
    setSaving(false);
    if (fail > 0) toast.error(`Importación parcial: ${ok} ok, ${fail} fallidos`, { description: firstErr ?? undefined });
    else toast.success(`${ok} índice(s) importados`);
    await onChange();
    setOpen(false);
    reset();
  };

  const downloadTemplate = () => downloadIneiTemplate();



  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Upload className="mr-1 h-4 w-4" /> Importar CSV</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar índices INEI desde CSV</DialogTitle>
          <DialogDescription>
            Columnas aceptadas: <code>code</code> (o <code>codigo</code>), <code>value</code> (o <code>valor</code>),
            opcionales <code>period_month</code> y <code>description</code>. Si el CSV no incluye mes, indica uno por defecto abajo.
            Filas con el mismo (mes, código) actualizan el valor existente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Button variant="ghost" size="sm" onClick={downloadTemplate} className="w-fit">
            <Download className="mr-1 h-4 w-4" /> Descargar plantilla
          </Button>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Mes por defecto (si el CSV no trae columna de mes)</Label>
              <Input
                type="month"
                value={fallbackPeriod ? fallbackPeriod.slice(0, 7) : ""}
                onChange={(e) => reparseWithPeriod(e.target.value ? `${e.target.value}-01` : "")}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Archivo CSV</Label>
              <Input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
              />
              {fileName ? <p className="text-xs text-muted-foreground">{fileName}</p> : null}
            </div>
          </div>

          {errors.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          ) : null}

          {parsed ? (
            <div className="space-y-2">
              <div className="flex gap-3 text-sm">
                <Badge variant="secondary">Total: {parsed.length}</Badge>
                <Badge variant="default">Válidas: {valid.length}</Badge>
                {invalid.length > 0 ? <Badge variant="destructive">Inválidas: {invalid.length}</Badge> : null}
              </div>

              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Línea</TableHead>
                      <TableHead>Mes</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.slice(0, 200).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{r.__line}</TableCell>
                        <TableCell>{r.period_month || "—"}</TableCell>
                        <TableCell>{r.code || "—"}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{r.description ?? "—"}</TableCell>
                        <TableCell>{Number.isFinite(r.value) ? r.value.toFixed(4) : "—"}</TableCell>
                        <TableCell>
                          {r.__error
                            ? <Badge variant="destructive" className="text-[10px]">{r.__error}</Badge>
                            : <Badge variant="secondary" className="text-[10px]">OK</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parsed.length > 200 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Mostrando 200 de {parsed.length} filas.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || valid.length === 0}>
            {saving ? "Importando…" : `Importar ${valid.length} fila(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Índices unificados INEI</CardTitle>
          <CardDescription>{isAdmin ? "Solo administradores globales pueden modificar." : "Consulta del catálogo INEI."}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={downloadIneiTemplate}>
            <Download className="mr-1 h-4 w-4" /> Plantilla CSV
          </Button>
          {isAdmin ? <ImportCsvDialog onChange={onChange} /> : null}
        </div>
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
