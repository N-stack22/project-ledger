// Proveedor de IA basado en Ollama (servidor local o remoto).
// Lee la configuración desde variables de entorno:
//   OLLAMA_BASE_URL  (por defecto http://localhost:11434)
//   OLLAMA_MODEL     (por defecto qwen2.5:7b-instruct)

import type { AIProvider, DraftContext, DraftSectionKey, DraftSections } from "../types";
import { AIProviderUnavailableError, DRAFT_SECTIONS } from "../types";
import { SYSTEM_PROMPT, buildUserPrompt } from "../prompt";

function emptyDraft(sections: DraftSectionKey[]): DraftSections {
  const out = {} as DraftSections;
  const all = sections.length ? sections : DRAFT_SECTIONS.map((s) => s.key);
  for (const key of all) out[key] = "";
  return out;
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts?: { baseUrl?: string; model?: string }) {
    this.baseUrl = (opts?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, "");
    this.model = opts?.model ?? process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generateTechnicalDraft(
    context: DraftContext,
    sections?: DraftSectionKey[],
  ): Promise<DraftSections> {
    const targetSections = sections?.length ? sections : DRAFT_SECTIONS.map((s) => s.key);
    const userPrompt = buildUserPrompt(context, targetSections);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: "json",
          options: { temperature: 0.2 },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new AIProviderUnavailableError(
        this.name,
        `No se pudo conectar a Ollama en ${this.baseUrl}. Verifica que el servidor esté activo. (${(err as Error).message})`,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AIProviderUnavailableError(
        this.name,
        `Ollama respondió HTTP ${res.status}. ${detail.slice(0, 200)}`,
      );
    }

    const payload = (await res.json()) as { message?: { content?: string } };
    const raw = payload.message?.content ?? "";
    const draft = emptyDraft(targetSections);
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of targetSections) {
        const v = parsed[key];
        if (typeof v === "string") draft[key] = v.trim();
      }
    } catch {
      // Si el modelo no devolvió JSON válido, devolvemos el texto crudo en la primera sección
      // para que el usuario aún tenga algo editable.
      draft[targetSections[0]] = raw.trim();
    }
    return draft;
  }
}
