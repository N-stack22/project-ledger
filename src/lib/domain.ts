import type { Database, Json } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type ContractType = Database["public"]["Enums"]["contract_type"];
export type ProjectStatus = Database["public"]["Enums"]["project_status"];
export type EntryStatus = Database["public"]["Enums"]["entry_status"];
export type DocumentStatus = Database["public"]["Enums"]["document_status"];
export type ValuationStatus = Database["public"]["Enums"]["valuation_status"];
export type LiquidationStatus = Database["public"]["Enums"]["liquidation_status"];
export type WorkflowAction = Database["public"]["Enums"]["workflow_action"];
export type WorkflowEntity = Database["public"]["Enums"]["workflow_entity"];

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type BudgetImportRow = Database["public"]["Tables"]["budget_imports"]["Row"];
export type BudgetItemRow = Database["public"]["Tables"]["budget_items"]["Row"];
export type MetradoEntryRow = Database["public"]["Tables"]["metrado_entries"]["Row"];
export type MemoriaRow = Database["public"]["Tables"]["memoria_valorizada"]["Row"];
export type ValuationRow = Database["public"]["Tables"]["valuations"]["Row"];
export type ValuationLineRow = Database["public"]["Tables"]["valuation_lines"]["Row"];
export type LiquidationRow = Database["public"]["Tables"]["liquidations"]["Row"];
export type WorkflowCommentRow = Database["public"]["Tables"]["workflow_comments"]["Row"];
export type UserRoleRow = Database["public"]["Tables"]["user_roles"]["Row"];

export type RichTextDocument = {
  html: string;
  plainText: string;
};

export type DashboardMetric = {
  label: string;
  value: string;
  hint: string;
};

export type BudgetColumnKey = "item_code" | "description" | "unit" | "base_quantity" | "unit_price" | "partial_amount" | "category";

export type BudgetPreviewRow = {
  item_code?: string;
  description: string;
  unit: string;
  base_quantity: number;
  unit_price: number;
  partial_amount: number;
  category?: string;
};

export type BudgetDetectionResult = {
  mapping: Partial<Record<BudgetColumnKey, string>>;
  rows: BudgetPreviewRow[];
  warnings: string[];
};

export type AuditSummary = {
  action: string;
  actor: string;
  timestamp: string;
  entity: string;
};

export function parseRichTextDocument(value: Json | null | undefined): RichTextDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { html: "", plainText: "" };
  }

  const html = typeof value.html === "string" ? value.html : "";
  const plainText = typeof value.plainText === "string" ? value.plainText : stripHtml(html);

  return { html, plainText };
}

export function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
