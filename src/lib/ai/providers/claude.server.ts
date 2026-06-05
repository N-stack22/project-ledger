// Proveedor de IA basado en Anthropic Claude.
// Lee ANTHROPIC_API_KEY y opcionalmente ANTHROPIC_MODEL.

import type { AIProvider, DraftContext, DraftSectionKey, DraftSections } from "../types";
import { AIProviderUnavailableError, DRAFT_SECTIONS } from "../types";
import { SYSTEM_PROMPT, buildUserPrompt } from "../prompt";

const DEFAULT_MODEL = "claude-sonnet-4-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function emptyDraft(sections: DraftSectionKey[]): DraftSections {
  const out = {} as DraftSections;
  const all = sections.length ? sections : DRAFT_SECTIONS.map((s) => s.key);
  for (const key of all) out[key] = "";
  return out;
}

export class ClaudeProvider implements AIProvider {
  readonly name = "claude";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.model = opts?.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async generateTechnicalDraft(
    context: DraftContext,
    sections?: DraftSectionKey[],
  ): Promise<DraftSections> {
    if (!this.apiKey) {
      throw new AIProviderUnavailableError(
        this.name,
        "Falta ANTHROPIC_API_KEY. Configúrala en los secretos de Lovable Cloud.",
      );
    }

    const targetSections = sections?.length ? sections : DRAFT_SECTIONS.map((s) => s.key);
    const userPrompt = buildUserPrompt(context, targetSections);

    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          temperature: 0.2,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new AIProviderUnavailableError(
        this.name,
        `No se pudo contactar a Anthropic. (${(err as Error).message})`,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AIProviderUnavailableError(
        this.name,
        `Anthropic respondió HTTP ${res.status}. ${detail.slice(0, 300)}`,
      );
    }

    const payload = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const raw = (payload.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("\n")
      .trim();

    const draft = emptyDraft(targetSections);
    // Claude puede envolver el JSON en texto. Intentamos extraerlo.
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : raw;
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      for (const key of targetSections) {
        const v = parsed[key];
        if (typeof v === "string") draft[key] = v.trim();
      }
    } catch {
      draft[targetSections[0]] = raw;
    }
    return draft;
  }
}
