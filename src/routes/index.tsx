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

        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 md:py-28 lg:grid-cols-12 lg:gap-8">
          <div className="space-y-8 lg:col-span-7">
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
              Sistema integral para gestión mensual de presupuestos, metrados
              ejecutados, memoria valorizada y liquidación de obras. Trazable,
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
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border bg-border text-xs">
              {[
                ["Módulos", "11"],
                ["Reportes PDF", "Auto"],
                ["Trazabilidad", "100%"],
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

          {/* Visual técnico tipo blueprint */}
          <div className="relative lg:col-span-5">
            <div className="relative aspect-square overflow-hidden rounded-sm border border-border bg-card">
              <div className="absolute inset-0 bg-[linear-gradient(to_right,oklch(1_0_0/0.06)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0/0.06)_1px,transparent_1px)] bg-[size:24px_24px]" />
              {/* Cruz de mira CAD */}
              <Crosshair
                className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 text-foreground/80"
                strokeWidth={0.8}
              />
              {/* Etiquetas de medición */}
              <div className="absolute left-4 top-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                X: 0.000 · Y: 0.000
              </div>
              <div className="absolute bottom-4 left-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Layer · METRADOS_EJEC
              </div>
              <div className="absolute bottom-4 right-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Scale 1 : 100
              </div>
              {/* Líneas dimensionales decorativas */}
              <svg
                className="absolute inset-0 h-full w-full text-foreground/30"
                fill="none"
                stroke="currentColor"
              >
                <line x1="40" y1="60" x2="40" y2="90%" strokeWidth="1" />
                <line x1="40" y1="60" x2="90%" y2="60" strokeWidth="1" />
                <line
                  x1="40"
                  y1="50%"
                  x2="90%"
                  y2="50%"
                  strokeWidth="0.5"
                  strokeDasharray="4 4"
                />
              </svg>
            </div>
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
              06 / 06
            </span>
          </div>

          <div className="grid gap-px bg-border md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: FileSpreadsheet,
                code: "01",
                title: "Presupuesto base",
                desc: "Importación Excel con detección automática de columnas y registro de partidas.",
              },
              {
                icon: Ruler,
                code: "02",
                title: "Metrados ejecutados",
                desc: "Planillas detalladas por partida con fórmulas, sustento y consolidado mensual.",
              },
              {
                icon: FileStack,
                code: "03",
                title: "Expediente mensual",
                desc: "Memoria valorizada e informe técnico estructurado igual al expediente real.",
              },
              {
                icon: WalletCards,
                code: "04",
                title: "Valorizaciones",
                desc: "Cálculo de valorización del período, deducciones y monto a pagar.",
              },
              {
                icon: Layers,
                code: "05",
                title: "Liquidación",
                desc: "Cierre técnico-económico de obra con trazabilidad completa.",
              },
              {
                icon: Gauge,
                code: "06",
                title: "Dashboard",
                desc: "Indicadores físicos y financieros en tiempo real con vista por proyecto.",
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
