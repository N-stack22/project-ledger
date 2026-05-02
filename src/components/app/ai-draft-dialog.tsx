import { useMemo, useState } from "react";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { generateTechnicalDraft } from "@/lib/ai/draft.functions";
import {
  DRAFT_SECTIONS,
  type DraftSectionKey,
  type DraftSections,
} from "@/lib/ai/types";
import type { ProjectRow } from "@/lib/domain";
import { toPeriodDate } from "@/lib/business";

interface AIDraftDialogProps {
  projects: ProjectRow[];
  defaultProjectId?: string;
  defaultPeriod?: string; // formato YYYY-MM o YYYY-MM-DD
  defaultObservations?: string;
  defaultExecutiveSummary?: string;
  /**
   * Llamado cuando el usuario inserta el borrador completo en el editor principal.
   * Recibe HTML listo para pegar en el RichTextEditor.
   */
  onApplyAll?: (html: string) => void;
}

function emptySections(): DraftSections {
  return DRAFT_SECTIONS.reduce((acc, s) => {
    acc[s.key] = "";
    return acc;
  }, {} as DraftSections);
}

function sectionsToHtml(sections: DraftSections): string {
  return DRAFT_SECTIONS.map((s) => {
    const text = (sections[s.key] ?? "").trim();
    if (!text) return "";
    const paragraphs = text
      .split(/\n+/)
      .map((p) => `<p>${p.replace(/</g, "&lt;")}</p>`)
      .join("");
    return `<h3>${s.label}</h3>${paragraphs}`;
  })
    .filter(Boolean)
    .join("");
}

export function AIDraftDialog({
  projects,
  defaultProjectId,
  defaultPeriod,
  defaultObservations,
  defaultExecutiveSummary,
  onApplyAll,
}: AIDraftDialogProps) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [period, setPeriod] = useState(defaultPeriod?.slice(0, 7) ?? "");
  const [observations, setObservations] = useState(defaultObservations ?? "");
  const [execSummary, setExecSummary] = useState(defaultExecutiveSummary ?? "");
  const [sections, setSections] = useState<DraftSections>(emptySections());
  const [loading, setLoading] = useState(false);
  const [regenKey, setRegenKey] = useState<DraftSectionKey | null>(null);
  const [provider, setProvider] = useState<string>("");

  const generateFn = useServerFn(generateTechnicalDraft);

  const canGenerate = useMemo(
    () => Boolean(projectId) && /^\d{4}-\d{2}$/.test(period),
    [projectId, period],
  );

  async function runGeneration(targetSections?: DraftSectionKey[]) {
    if (!canGenerate) {
      toast.error("Selecciona un proyecto y un período (mes).");
      return;
    }
    const isRegen = Boolean(targetSections?.length);
    if (isRegen) setRegenKey(targetSections![0]);
    else setLoading(true);
    try {
      const result = await generateFn({
        data: {
          project_id: projectId,
          period_month: toPeriodDate(period),
          observations: observations || undefined,
          executive_summary: execSummary || undefined,
          sections: targetSections,
        },
      });
      setProvider(result.provider);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSections((prev) => ({ ...prev, ...result.sections }));
      toast.success(
        isRegen
          ? `Sección regenerada (${result.provider}).`
          : `Borrador generado (${result.provider}).`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al generar el borrador.",
      );
    } finally {
      setLoading(false);
      setRegenKey(null);
    }
  }

  function applyAll() {
    if (!onApplyAll) {
      setOpen(false);
      return;
    }
    const html = sectionsToHtml(sections);
    if (!html) {
      toast.error("El borrador está vacío. Genera contenido primero.");
      return;
    }
    onApplyAll(html);
    toast.success("Borrador insertado en el editor. Revísalo y edítalo antes de guardar.");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setProjectId(defaultProjectId ?? projectId);
          setPeriod((defaultPeriod?.slice(0, 7) ?? period) || "");
          setObservations(defaultObservations ?? observations);
          setExecSummary(defaultExecutiveSummary ?? execSummary);
          setOpen(true);
        }}
      >
        <Sparkles className="mr-2 h-4 w-4" />
        Generar borrador con IA
      </Button>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Borrador asistido — Memoria valorizada</DialogTitle>
          <DialogDescription>
            La IA solo redacta usando los datos ya cargados (proyecto, partidas, metrados,
            valorización). No calcula ni modifica datos. Edita manualmente antes de guardar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Proyecto</label>
              <Select value={projectId} onValueChange={setProjectId}>
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
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Período</label>
              <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Observaciones del usuario (opcional)
            </label>
            <Textarea
              rows={2}
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              placeholder="Notas, ocurrencias, hechos relevantes del período…"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => runGeneration()} disabled={loading || !canGenerate}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Generar borrador completo
            </Button>
            {provider ? (
              <Badge variant="outline" className="text-xs">
                proveedor: {provider}
              </Badge>
            ) : null}
          </div>

          <div className="space-y-3">
            {DRAFT_SECTIONS.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{s.label}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={loading || regenKey !== null || !canGenerate}
                    onClick={() => runGeneration([s.key])}
                  >
                    {regenKey === s.key ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    )}
                    Regenerar
                  </Button>
                </div>
                <Textarea
                  className="mt-2"
                  rows={4}
                  value={sections[s.key] ?? ""}
                  onChange={(e) =>
                    setSections((prev) => ({ ...prev, [s.key]: e.target.value }))
                  }
                  placeholder="(vacío) — genera el borrador o redacta manualmente"
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
          <Button onClick={applyAll}>Insertar en el editor</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
