import { createFileRoute, Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-background">
      <section className="border-b border-border">
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-16 lg:px-10">
          <div className="space-y-5">
            <Badge variant="outline">JJ&amp;PP Ingenieros</Badge>
            <div className="space-y-4">
              <h1 className="max-w-4xl text-4xl font-semibold text-foreground md:text-5xl">
                Sistema web para gestión mensual de metrados, valorizaciones y liquidación de obras.
              </h1>
              <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
                Centraliza presupuesto base, metrados ejecutados, memoria valorizada, valorizaciones mensuales y reportes PDF en un flujo trazable.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/login">Ingresar</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/app/dashboard">Abrir panel</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["Presupuesto flexible", "Importación de Excel con detección de columnas y registro de partidas."],
              ["Operación mensual", "Registro de metrados por periodo y memoria valorizada antes de valorizar."],
              ["Salida documental", "Exportación inicial de reportes y documentos operativos a PDF y Excel."],
            ].map(([title, description]) => (
              <Card key={title}>
                <CardHeader>
                  <CardTitle className="text-base">{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-1 w-16 rounded-full bg-primary" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
