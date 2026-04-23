export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_data: Json | null
          previous_data: Json | null
          project_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_data?: Json | null
          previous_data?: Json | null
          project_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_data?: Json | null
          previous_data?: Json | null
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_imports: {
        Row: {
          column_mapping: Json | null
          created_at: string
          error_details: Json | null
          file_name: string
          file_path: string
          id: string
          imported_at: string | null
          project_id: string
          status: Database["public"]["Enums"]["import_status"]
          updated_at: string
          uploaded_by: string
          validation_summary: Json | null
        }
        Insert: {
          column_mapping?: Json | null
          created_at?: string
          error_details?: Json | null
          file_name: string
          file_path: string
          id?: string
          imported_at?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["import_status"]
          updated_at?: string
          uploaded_by: string
          validation_summary?: Json | null
        }
        Update: {
          column_mapping?: Json | null
          created_at?: string
          error_details?: Json | null
          file_name?: string
          file_path?: string
          id?: string
          imported_at?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["import_status"]
          updated_at?: string
          uploaded_by?: string
          validation_summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_imports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_items: {
        Row: {
          base_quantity: number
          budget_import_id: string | null
          category: string | null
          created_at: string
          description: string
          id: string
          item_code: string | null
          partial_amount: number
          project_id: string
          sort_order: number
          unit: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          base_quantity?: number
          budget_import_id?: string | null
          category?: string | null
          created_at?: string
          description: string
          id?: string
          item_code?: string | null
          partial_amount?: number
          project_id: string
          sort_order?: number
          unit: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          base_quantity?: number
          budget_import_id?: string | null
          category?: string | null
          created_at?: string
          description?: string
          id?: string
          item_code?: string | null
          partial_amount?: number
          project_id?: string
          sort_order?: number
          unit?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_items_budget_import_id_fkey"
            columns: ["budget_import_id"]
            isOneToOne: false
            referencedRelation: "budget_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      liquidations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string
          final_amount: number
          generated_document_path: string | null
          id: string
          project_id: string
          status: Database["public"]["Enums"]["liquidation_status"]
          summary_text: string | null
          total_deductions_amount: number
          total_valued_amount: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by: string
          final_amount?: number
          generated_document_path?: string | null
          id?: string
          project_id: string
          status?: Database["public"]["Enums"]["liquidation_status"]
          summary_text?: string | null
          total_deductions_amount?: number
          total_valued_amount?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          final_amount?: number
          generated_document_path?: string | null
          id?: string
          project_id?: string
          status?: Database["public"]["Enums"]["liquidation_status"]
          summary_text?: string | null
          total_deductions_amount?: number
          total_valued_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "liquidations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      memoria_valorizada: {
        Row: {
          content_json: Json
          created_at: string
          created_by: string
          document_path: string | null
          executive_summary: string | null
          id: string
          period_month: string
          project_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["document_status"]
          title: string
          updated_at: string
          version_number: number
        }
        Insert: {
          content_json?: Json
          created_at?: string
          created_by: string
          document_path?: string | null
          executive_summary?: string | null
          id?: string
          period_month: string
          project_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          title: string
          updated_at?: string
          version_number?: number
        }
        Update: {
          content_json?: Json
          created_at?: string
          created_by?: string
          document_path?: string | null
          executive_summary?: string | null
          id?: string
          period_month?: string
          project_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          title?: string
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "memoria_valorizada_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      metrado_entries: {
        Row: {
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          notes: string | null
          period_month: string
          project_id: string
          quantity: number
          status: Database["public"]["Enums"]["entry_status"]
          updated_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          entry_date: string
          id?: string
          item_id: string
          notes?: string | null
          period_month: string
          project_id: string
          quantity: number
          status?: Database["public"]["Enums"]["entry_status"]
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          entry_date?: string
          id?: string
          item_id?: string
          notes?: string | null
          period_month?: string
          project_id?: string
          quantity?: number
          status?: Database["public"]["Enums"]["entry_status"]
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metrado_entries_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrado_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          is_active: boolean
          job_title: string | null
          phone: string | null
          signature_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          phone?: string | null
          signature_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          phone?: string | null
          signature_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_end_date: string | null
          client_name: string | null
          code: string
          contract_amount: number
          contract_type: Database["public"]["Enums"]["contract_type"]
          created_at: string
          created_by: string | null
          currency_code: string
          description: string | null
          id: string
          location: string | null
          name: string
          planned_end_date: string | null
          progress_percent: number
          start_date: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          actual_end_date?: string | null
          client_name?: string | null
          code: string
          contract_amount?: number
          contract_type: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          created_by?: string | null
          currency_code?: string
          description?: string | null
          id?: string
          location?: string | null
          name: string
          planned_end_date?: string | null
          progress_percent?: number
          start_date?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          actual_end_date?: string | null
          client_name?: string | null
          code?: string
          contract_amount?: number
          contract_type?: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          created_by?: string | null
          currency_code?: string
          description?: string | null
          id?: string
          location?: string | null
          name?: string
          planned_end_date?: string | null
          progress_percent?: number
          start_date?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      valuation_lines: {
        Row: {
          created_at: string
          id: string
          item_id: string
          line_amount: number
          percentage_applied: number
          quantity_accumulated: number
          quantity_period: number
          unit_price_applied: number
          updated_at: string
          valuation_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          line_amount?: number
          percentage_applied?: number
          quantity_accumulated?: number
          quantity_period?: number
          unit_price_applied?: number
          updated_at?: string
          valuation_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          line_amount?: number
          percentage_applied?: number
          quantity_accumulated?: number
          quantity_period?: number
          unit_price_applied?: number
          updated_at?: string
          valuation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "valuation_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valuation_lines_valuation_id_fkey"
            columns: ["valuation_id"]
            isOneToOne: false
            referencedRelation: "valuations"
            referencedColumns: ["id"]
          },
        ]
      }
      valuations: {
        Row: {
          contract_type_snapshot: Database["public"]["Enums"]["contract_type"]
          created_at: string
          created_by: string
          deductions_amount: number
          generated_document_path: string | null
          gross_amount: number
          id: string
          memoria_id: string
          net_amount: number
          period_month: string
          progress_percent: number
          project_id: string
          resident_reviewed_at: string | null
          resident_reviewed_by: string | null
          status: Database["public"]["Enums"]["valuation_status"]
          supervisor_comment: string | null
          supervisor_reviewed_at: string | null
          supervisor_reviewed_by: string | null
          total_quantity: number
          updated_at: string
        }
        Insert: {
          contract_type_snapshot: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          created_by: string
          deductions_amount?: number
          generated_document_path?: string | null
          gross_amount?: number
          id?: string
          memoria_id: string
          net_amount?: number
          period_month: string
          progress_percent?: number
          project_id: string
          resident_reviewed_at?: string | null
          resident_reviewed_by?: string | null
          status?: Database["public"]["Enums"]["valuation_status"]
          supervisor_comment?: string | null
          supervisor_reviewed_at?: string | null
          supervisor_reviewed_by?: string | null
          total_quantity?: number
          updated_at?: string
        }
        Update: {
          contract_type_snapshot?: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          created_by?: string
          deductions_amount?: number
          generated_document_path?: string | null
          gross_amount?: number
          id?: string
          memoria_id?: string
          net_amount?: number
          period_month?: string
          progress_percent?: number
          project_id?: string
          resident_reviewed_at?: string | null
          resident_reviewed_by?: string | null
          status?: Database["public"]["Enums"]["valuation_status"]
          supervisor_comment?: string | null
          supervisor_reviewed_at?: string | null
          supervisor_reviewed_by?: string | null
          total_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "valuations_memoria_id_fkey"
            columns: ["memoria_id"]
            isOneToOne: true
            referencedRelation: "memoria_valorizada"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valuations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_comments: {
        Row: {
          action: Database["public"]["Enums"]["workflow_action"]
          comment_text: string
          created_at: string
          created_by: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["workflow_entity"]
          id: string
          project_id: string
        }
        Insert: {
          action?: Database["public"]["Enums"]["workflow_action"]
          comment_text: string
          created_at?: string
          created_by: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["workflow_entity"]
          id?: string
          project_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["workflow_action"]
          comment_text?: string
          created_at?: string
          created_by?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["workflow_entity"]
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_edit_project_data: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_review_project_data: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "assistant"
        | "resident"
        | "supervisor"
        | "legal_representative"
      contract_type: "precios_unitarios" | "suma_alzada"
      document_status: "draft" | "in_review" | "approved" | "rejected"
      entry_status: "draft" | "submitted" | "validated" | "rejected"
      import_status:
        | "pending"
        | "processing"
        | "validated"
        | "imported"
        | "failed"
      liquidation_status: "draft" | "generated" | "approved"
      project_status: "draft" | "active" | "closing" | "closed" | "archived"
      valuation_status: "pending" | "reviewed" | "approved" | "rejected"
      workflow_action:
        | "created"
        | "submitted"
        | "reviewed"
        | "approved"
        | "rejected"
        | "commented"
        | "exported"
        | "closed"
      workflow_entity: "memoria_valorizada" | "valuation" | "liquidation"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "assistant",
        "resident",
        "supervisor",
        "legal_representative",
      ],
      contract_type: ["precios_unitarios", "suma_alzada"],
      document_status: ["draft", "in_review", "approved", "rejected"],
      entry_status: ["draft", "submitted", "validated", "rejected"],
      import_status: [
        "pending",
        "processing",
        "validated",
        "imported",
        "failed",
      ],
      liquidation_status: ["draft", "generated", "approved"],
      project_status: ["draft", "active", "closing", "closed", "archived"],
      valuation_status: ["pending", "reviewed", "approved", "rejected"],
      workflow_action: [
        "created",
        "submitted",
        "reviewed",
        "approved",
        "rejected",
        "commented",
        "exported",
        "closed",
      ],
      workflow_entity: ["memoria_valorizada", "valuation", "liquidation"],
    },
  },
} as const
