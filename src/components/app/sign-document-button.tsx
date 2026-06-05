import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, PenLine, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Database } from "@/integrations/supabase/types";

type SignatureDocumentType = Database["public"]["Enums"]["signature_document_type"];

interface Props {
  projectId: string;
  documentId: string;
  documentType: SignatureDocumentType;
  // Serializable payload to hash (snapshot of document content)
  payload: unknown;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function SignDocumentButton({ projectId, documentId, documentType, payload }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [signed, setSigned] = useState<{ at: string; token: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!user) return;
      const { data } = await supabase
        .from("firmas_electronicas")
        .select("signed_at, verification_token, revoked_at")
        .eq("document_id", documentId)
        .eq("document_type", documentType)
        .eq("signer_user_id", user.id)
        .is("revoked_at", null)
        .maybeSingle();
      if (!active) return;
      if (data) setSigned({ at: data.signed_at, token: data.verification_token });
    })();
    return () => {
      active = false;
    };
  }, [user, documentId, documentType]);

  const handleSign = async () => {
    if (!user) {
      toast.error("Debes iniciar sesión para firmar.");
      return;
    }
    setLoading(true);
    try {
      const hash = await sha256Hex(JSON.stringify(payload));
      const { data: member } = await supabase
        .from("project_members")
        .select("project_role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();
      const { data, error } = await supabase
        .from("firmas_electronicas")
        .insert({
          project_id: projectId,
          document_id: documentId,
          document_type: documentType,
          signer_user_id: user.id,
          signer_project_role: member?.project_role ?? null,
          content_hash: hash,
          user_agent: navigator.userAgent.slice(0, 255),
        })
        .select("signed_at, verification_token")
        .single();
      if (error) throw error;
      setSigned({ at: data.signed_at, token: data.verification_token });
      toast.success("Documento firmado electrónicamente.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo firmar el documento.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (signed) {
    return (
      <Button size="sm" variant="ghost" disabled className="gap-1">
        <ShieldCheck className="h-4 w-4 text-primary" />
        Firmado · {signed.token.slice(0, 8)}
      </Button>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={handleSign} disabled={loading} className="gap-1">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
      Firmar
    </Button>
  );
}
