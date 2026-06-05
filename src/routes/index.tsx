import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  FileSpreadsheet,
  FileStack,
  Gauge,
  HardHat,
  Layers,
  Ruler,
  WalletCards,
  TrendingUp,
  CheckSquare,
  FolderKanban,
  FileText,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/app/theme-toggle";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* TOPBAR estilo Autodesk */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-foreground text-background">
              <HardHat className="h-4 w-4" />
            </div>
            <span className="text-sm font-bold uppercase tracking-[0.18em]">
              JJ&PP <span className="text-muted-foreground">Ingenieros</span>
            </span>
          </div>
          <nav className="hidden items-center gap-6 text-xs font-medium uppercase tracking-wider text-muted-foreground md:flex">
            <a href="#producto" className="hover:text-foreground">Producto</a>
            <a href="#modulos" className="hover:text-foreground">Módulos</a>
            <a href="#flujo" className="hover:text-foreground">Flujo</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Ingresar</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/app/dashboard">Abrir panel</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section
        id="producto"
        className="relative overflow-hidden border-b border-border"
      >
        {/* Marcas técnicas estilo CAD */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] bg-[size:64px_64px]" />
        </div>
        <div className="absolute right-8 top-20 hidden flex-col items-end gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground md:flex">
          <span>v.2026.04 — REL</span>
          <span>build · stable</span>
        </div>

        <div className="relative mx-auto max-w-7xl px-6 py-20 md:py-28">
          <div className="space-y-8 max-w-3xl">
            <div className="flex items-center gap-3">
              <span className="h-px w-10 bg-foreground" />
              <Badge
                variant="outline"
                className="rounded-none border-foreground/40 bg-transparent font-mono text-[10px] uppercase tracking-[0.2em] text-foreground"
              >
                Plataforma técnica · Obra pública
              </Badge>
            </div>

            <h1 className="text-5xl font-extrabold uppercase leading-[0.95] tracking-tight md:text-7xl">
              Diseñado para
              <br />
              <span className="text-muted-foreground">controlar</span> cada
              <br />
              metrado.
            </h1>

            <p className="max-w-xl text-base text-muted-foreground md:text-lg">
              Plataforma integral para obra pública: proyectos, presupuestos,
              metrados ejecutados, memoria valorizada, valorizaciones mensuales,
              reajustes con índices INEI y liquidación final. Trazable,
              auditable y construido al detalle como un plano.
            </p>

            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-sm uppercase tracking-wider">
                <Link to="/app/dashboard">
                  Iniciar plataforma <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-sm border-foreground/30 uppercase tracking-wider hover:bg-accent"
              >
                <Link to="/login">Ver demo técnica</Link>
              </Button>
            </div>

            {/* Specs estilo ficha técnica */}
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border bg-border text-xs max-w-xl">
              {[
                ["Módulos", "12"],
                ["PDF cliente", "Sí"],
                ["Roles RLS", "5"],
              ].map(([k, v]) => (
                <div key={k} className="bg-card px-4 py-3">
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {k}
                  </dt>
                  <dd className="mt-1 text-2xl font-bold tracking-tight">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* MÓDULOS estilo cards técnicas */}
      <section id="modulos" className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mb-12 flex items-end justify-between gap-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                / Módulos del sistema
              </p>
              <h2 className="mt-3 text-3xl font-extrabold uppercase tracking-tight md:text-5xl">
                Cada herramienta en su capa.
              </h2>
            </div>
            <span className="hidden font-mono text-xs uppercase tracking-widest text-muted-foreground md:inline">
              09 / 09
            </span>
          </div>

          <div className="grid gap-px bg-border md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: FolderKanban,
                code: "01",
                title: "Proyectos",
                desc: "Ficha técnica completa por obra, miembros y permisos por rol (admin, residente, supervisor, asistente, legal).",
              },
              {
                icon: FileSpreadsheet,
                code: "02",
                title: "Presupuesto",
                desc: "Registro de partidas del presupuesto base con unidades, metrados y precios unitarios.",
              },
              {
                icon: Ruler,
                code: "03",
                title: "Metrados ejecutados",
                desc: "Planillas detalladas por partida con fórmulas o dimensiones y consolidado mensual.",
              },
              {
                icon: FileStack,
                code: "04",
                title: "Memoria valorizada",
                desc: "Narrativa técnica del período: generalidades, metas, ocurrencias y conclusiones.",
              },
              {
                icon: WalletCards,
                code: "05",
                title: "Valorizaciones",
                desc: "Valorización actual, anterior, acumulada, saldo y deducciones del catálogo.",
              },
              {
                icon: TrendingUp,
                code: "06",
                title: "Reajustes INEI",
                desc: "Importación CSV de índices INEI con validación de columnas, formatos y duplicados.",
              },
              {
                icon: FileText,
                code: "07",
                title: "Expediente PDF",
                desc: "Expediente mensual generado 100% en cliente con react-pdf, listo para descarga.",
              },
              {
                icon: Layers,
                code: "08",
                title: "Liquidación",
                desc: "Cierre técnico-económico de obra con trazabilidad acumulada.",
              },
              {
                icon: CheckSquare,
                code: "09",
                title: "Aprobaciones",
                desc: "Workflow de revisión y comentarios entre residente, supervisor y representante legal.",
              },
            ].map(({ icon: Icon, code, title, desc }) => (
              <div
                key={code}
                className="group relative bg-card p-6 transition-colors hover:bg-accent"
              >
                <div className="mb-6 flex items-center justify-between">
                  <Icon
                    className="h-8 w-8 text-foreground"
                    strokeWidth={1.25}
                  />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {code}
                  </span>
                </div>
                <h3 className="mb-2 text-lg font-bold uppercase tracking-tight">
                  {title}
                </h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
                <div className="mt-6 h-px w-8 bg-foreground transition-all group-hover:w-16" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FLUJO */}
      <section id="flujo" className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            / Flujo operativo
          </p>
          <h2 className="mt-3 max-w-3xl text-3xl font-extrabold uppercase tracking-tight md:text-5xl">
            Del presupuesto al PDF firmado.
          </h2>

          <ol className="mt-12 grid gap-px bg-border md:grid-cols-4">
            {[
              ["A", "Importar", "Sube el presupuesto base en Excel."],
              ["B", "Medir", "Registra metrados ejecutados del período."],
              ["C", "Valorizar", "Genera memoria y valorización mensual."],
              ["D", "Exportar", "Descarga expediente PDF listo para firma."],
            ].map(([step, title, desc]) => (
              <li key={step} className="bg-card p-6">
                <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Paso {step}
                </div>
                <div className="mt-3 text-2xl font-bold uppercase tracking-tight">
                  {title}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA + footer */}
      <section className="bg-card">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-16 md:flex-row md:items-center">
          <div>
            <h3 className="text-2xl font-extrabold uppercase tracking-tight md:text-4xl">
              Listo para tu próxima obra.
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Acceso inmediato a la plataforma técnica.
            </p>
          </div>
          <Button asChild size="lg" className="rounded-sm uppercase tracking-wider">
            <Link to="/app/dashboard">
              Abrir plataforma <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>© JJ&PP Ingenieros · Plataforma técnica</span>
          <span>v.2026.04</span>
        </div>
      </footer>
    </main>
  );
}
