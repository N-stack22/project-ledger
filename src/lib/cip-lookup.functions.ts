import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  cip: z.string().trim().regex(/^\d{4,8}$/, "CIP debe ser numérico de 4 a 8 dígitos"),
});

export type CipLookupResult = {
  found: boolean;
  cip: string;
  fullName?: string;
  chapter?: string;
  specialty?: string;
  status?: string;
  error?: string;
  raw?: string;
};

// Firecrawl NO usa el connector gateway de Lovable: se llama directo a su API
// oficial con FIRECRAWL_API_KEY (inyectada por el conector al vincularlo).
const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";

/**
 * Consulta pública del CIP (Colegio de Ingenieros del Perú)
 * Fuente: https://cipvirtual.cip.org.pe/sicecolegiacionweb/externo/consultaCol/
 */
export const cipLookup = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }): Promise<CipLookupResult> => {
    const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

    if (!FIRECRAWL_API_KEY) {
      return {
        found: false,
        cip: data.cip,
        error: "El servicio de consulta CIP no está configurado (falta FIRECRAWL_API_KEY).",
      };
    }

    const candidates = [
      `https://cipvirtual.cip.org.pe/sicecolegiacionweb/externo/consultaCol/?codigo=${data.cip}`,
      `https://cipvirtual.cip.org.pe/sicecolegiacionweb/externo/consultaCol/`,
    ];

    let raw = "";
    let lastError = "";

    for (const url of candidates) {
      try {
        const res = await fetch(FIRECRAWL_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            formats: ["markdown", "html"],
            onlyMainContent: false,
            waitFor: 3000,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          lastError = `Firecrawl HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`;
          continue;
        }

        const json: unknown = await res.json();
        const payload = json as {
          data?: { markdown?: string; html?: string };
          markdown?: string;
          html?: string;
        };
        const md = payload.data?.markdown ?? payload.markdown ?? "";
        const html = payload.data?.html ?? payload.html ?? "";
        raw = `${md}\n${html}`;
        if (raw.includes(data.cip)) break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "fetch failed";
      }
    }

    if (!raw) {
      return {
        found: false,
        cip: data.cip,
        error: lastError || "No se pudo consultar el CIP. Completa el nombre manualmente.",
      };
    }

    // Heurísticas de parsing — el sitio devuelve filas tipo:
    // "CIP 123456 — APELLIDOS NOMBRES — Capítulo X — Especialidad Y"
    // Intentamos varios patrones.
    const result: CipLookupResult = { found: false, cip: data.cip, raw: raw.slice(0, 500) };

    // Buscar la línea que contiene el CIP
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const matchLine = lines.find((l) => new RegExp(`\\b${data.cip}\\b`).test(l));

    if (matchLine) {
      // Patrón típico: separados por |, tabs, espacios múltiples o guiones
      const parts = matchLine
        .split(/\s*[|\t]\s*|\s{2,}|\s+-\s+/)
        .map((p) => p.replace(/<[^>]+>/g, "").trim())
        .filter(Boolean);

      // Buscar nombre: bloque con letras y espacios, sin solo dígitos
      const namePart = parts.find(
        (p) => /[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s.,]{6,}/.test(p) && !/^\d+$/.test(p) && p !== data.cip,
      );

      if (namePart) {
        result.found = true;
        result.fullName = namePart.replace(/\s+/g, " ").trim();
      }
    }

    // Patrón alternativo: buscar etiquetas tipo "Nombre:" cerca del CIP
    if (!result.found) {
      const nameMatch = raw.match(/Nombre[s]?\s*[:\-]\s*([A-ZÁÉÍÓÚÑ][^\n<]{5,80})/i);
      if (nameMatch) {
        result.found = true;
        result.fullName = nameMatch[1].replace(/\s+/g, " ").trim();
      }
    }

    if (!result.found) {
      result.error =
        "No se pudo extraer el nombre del colegiado. Verifica el CIP en el sitio del CIP o complétalo manualmente.";
    }

    return result;
  });
