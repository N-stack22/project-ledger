// Tipos compartidos para la capa de IA (cliente y servidor).
// Esta capa es independiente del proveedor: Ollama, Lovable AI, OpenAI, etc.

export type DraftSectionKey =
  | "generalidades"
  | "ubicacion"
  | "metas"
  | "resumen_avance"
  | "descripcion_partidas"
  | "ocurrencias"
  | "conclusiones";

export const DRAFT_SECTIONS: { key: DraftSectionKey; label: string }[] = [
  { key: "generalidades", label: "Generalidades" },
  { key: "ubicacion", label: "Ubicación" },
  { key: "metas", label: "Metas del proyecto" },
  { key: "resumen_avance", label: "Resumen del avance" },
  { key: "descripcion_partidas", label: "Descripción de partidas ejecutadas" },
  { key: "ocurrencias", label: "Ocurrencias del período" },
  { key: "conclusiones", label: "Conclusiones preliminares" },
];

export interface DraftContext {
  project: {
    name: string;
    code: string;
    entity_name?: string | null;
    contractor_name?: string | null;
    supervisor_name?: string | null;
    resident_name?: string | null;
    execution_modality?: string | null;
    location?: string | null;
    department?: string | null;
    province?: string | null;
    district?: string | null;
    execution_contract?: string | null;
    supervision_contract?: string | null;
    contract_amount?: number | null;
    start_date?: string | null;
    planned_end_date?: string | null;
    execution_term_days?: number | null;
  };
  period: {
    label: string; // ej. "Junio 2026"
    month: string; // ISO (YYYY-MM-01)
  };
  partidas: Array<{
    code: string;
    description: string;
    unit: string;
    base_quantity: number;
    unit_price: number;
    quantity_period: number;
    quantity_accumulated: number;
  }>;
  metrados: Array<{
    item_code: string;
    description: string;
    unit: string;
    quantity: number;
    entry_date: string;
  }>;
  valuation?: {
    progress_percent: number;
    gross_amount: number;
    deductions_amount: number;
    net_amount: number;
  } | null;
  observations?: string;
  executive_summary?: string;
}

export type DraftSections = Record<DraftSectionKey, string>;

export interface AIProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generateTechnicalDraft(
    context: DraftContext,
    sections?: DraftSectionKey[],
  ): Promise<DraftSections>;
}

export class AIProviderUnavailableError extends Error {
  constructor(public providerName: string, message: string) {
    super(message);
    this.name = "AIProviderUnavailableError";
  }
}
