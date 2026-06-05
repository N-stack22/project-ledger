import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Users, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/components/app/workspace-provider";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/integrations/supabase/types";

type ProjectRole = Database["public"]["Enums"]["project_role"];
type AppRole = Database["public"]["Enums"]["app_role"];

const projectRoleLabels: Record<ProjectRole, string> = {
  admin_proyecto: "Administrador del proyecto",
  residente_obra: "Residente de obra",
  supervisor_inspector: "Supervisor / Inspector",
  entidad_publica: "Entidad pública",
  representante_legal: "Representante legal",
};

const projectRoleToAppRole: Record<ProjectRole, AppRole> = {
  admin_proyecto: "admin",
  residente_obra: "resident",
  supervisor_inspector: "supervisor",
  entidad_publica: "assistant",
  representante_legal: "legal_representative",
};

interface MemberRow {
  id: string;
  user_id: string;
  project_role: ProjectRole;
}

export function ProjectMembersDialog({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { profiles } = useWorkspace();
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [manualUserId, setManualUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("residente_obra");
  const [submitting, setSubmitting] = useState(false);

  const isProjectAdmin = useMemo(
    () => isAdmin || members.some((m) => m.user_id === user?.id && m.project_role === "admin_proyecto"),
    [isAdmin, members, user?.id],
  );

  const loadMembers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("project_members")
      .select("id, user_id, project_role")
      .eq("project_id", projectId);
    if (error) {
      toast.error("No se pudieron cargar los miembros", { description: error.message });
    } else {
      setMembers(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) void loadMembers();
  }, [open]);

  const profileName = (userId: string) => {
    const p = profiles.find((x) => x.user_id === userId);
    return p?.full_name || userId.slice(0, 8) + "…";
  };

  const availableProfiles = useMemo(
    () => profiles.filter((p) => !members.some((m) => m.user_id === p.user_id)),
    [profiles, members],
  );

  const addMember = async () => {
    const userId = (selectedUserId || manualUserId).trim();
    if (!userId) {
      toast.error("Indica el usuario a agregar");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("project_members").insert({
      project_id: projectId,
      user_id: userId,
      project_role: role,
      role: projectRoleToAppRole[role],
    });
    setSubmitting(false);
    if (error) {
      toast.error("No se pudo agregar el miembro", { description: error.message });
      return;
    }
    toast.success("Miembro agregado");
    setSelectedUserId("");
    setManualUserId("");
    await loadMembers();
  };

  const updateRole = async (memberId: string, newRole: ProjectRole) => {
    const { error } = await supabase
      .from("project_members")
      .update({ project_role: newRole, role: projectRoleToAppRole[newRole] })
      .eq("id", memberId);
    if (error) {
      toast.error("No se pudo actualizar el rol", { description: error.message });
      return;
    }
    toast.success("Rol actualizado");
    await loadMembers();
  };

  const removeMember = async (memberId: string) => {
    const { error } = await supabase.from("project_members").delete().eq("id", memberId);
    if (error) {
      toast.error("No se pudo eliminar", { description: error.message });
      return;
    }
    toast.success("Miembro eliminado");
    await loadMembers();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users className="mr-1 h-4 w-4" /> Miembros
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Miembros del proyecto</DialogTitle>
          <DialogDescription>{projectName}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                    Sin miembros aún
                  </TableCell>
                </TableRow>
              ) : (
                members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{profileName(m.user_id)}</TableCell>
                    <TableCell>
                      {isProjectAdmin && m.user_id !== user?.id ? (
                        <Select value={m.project_role} onValueChange={(v) => updateRole(m.id, v as ProjectRole)}>
                          <SelectTrigger className="h-8 w-full max-w-[220px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(projectRoleLabels).map(([v, l]) => (
                              <SelectItem key={v} value={v}>{l}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">{projectRoleLabels[m.project_role]}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {isProjectAdmin && m.user_id !== user?.id ? (
                        <Button variant="ghost" size="icon" onClick={() => removeMember(m.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {isProjectAdmin ? (
          <div className="space-y-3 rounded-md border border-dashed p-4">
            <p className="text-sm font-medium">Agregar miembro</p>
            {availableProfiles.length > 0 ? (
              <div className="space-y-2">
                <Label className="text-xs">Selecciona un perfil</Label>
                <Select value={selectedUserId} onValueChange={(v) => { setSelectedUserId(v); setManualUserId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Buscar usuario…" /></SelectTrigger>
                  <SelectContent>
                    {availableProfiles.map((p) => (
                      <SelectItem key={p.user_id} value={p.user_id}>
                        {p.full_name || p.user_id.slice(0, 8) + "…"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label className="text-xs">O ingresa el ID de usuario (UUID)</Label>
              <Input
                placeholder="00000000-0000-0000-0000-000000000000"
                value={manualUserId}
                onChange={(e) => { setManualUserId(e.target.value); setSelectedUserId(""); }}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Rol en el proyecto</Label>
              <Select value={role} onValueChange={(v) => setRole(v as ProjectRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(projectRoleLabels).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button onClick={addMember} disabled={submitting}>
                {submitting ? "Agregando…" : "Agregar"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Solo el administrador del proyecto puede modificar miembros.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
