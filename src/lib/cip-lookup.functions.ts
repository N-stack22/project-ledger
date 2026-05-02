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

const GATEWAY_URL = "https://connector-gateway.lovable.dev/firecrawl";

/**
 * Consulta pública del CIP (Colegio de Ingenieros del Perú)
 * Fuente: https://cipvirtual.cip.org.pe/sicecolegiacionweb/externo/consultaCol/
 *
 * Estrategia: usar Firecrawl para scrapear la página pasando el CIP como parámetro
 * (?codigo=NNNN) y luego intentar parsear el resultado del DOM.
 *
 * NOTA: el sitio del CIP puede tener CAPTCHA o requerir JS. Si Firecrawl no logra
 * extraer datos estructurados, devolvemos found:false y el usuario completa manualmente.
 */
export const cipLookup = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }): Promise<CipLookupResult> => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

    if (!LOVABLE_API_KEY || !FIRECRAWL_API_KEY) {
      return {
        found: false,
        cip: data.cip,
        error: "El servicio de consulta CIP no está configurado.",
      };
    }

    // URLs candidatas: el sitio público acepta consultas con el código de colegiatura
    const candidates = [
      `https://cipvirtual.cip.org.pe/sicecolegiacionweb/externo/consultaCol/?codigo=${data.cip}`,
      `https://cipvirtual.cip.org.pe/sicecolegiacionweb/externo/consultaCol/`,
    ];

    let raw = "";
    let lastError = "";

    for (const url of candidates) {
      try {
        const res = await fetch(`${GATEWAY_URL}/v2/scrape`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": FIRECRAWL_API_KEY,
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
          lastError = `Firecrawl HTTP ${res.status}`;
          continue;
        }

        const json: unknown = await res.json();
        const payload = (json as { data?: { markdown?: string; html?: string }; markdown?: string; html?: string });
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
