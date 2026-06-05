import { describe, expect, it } from "vitest";

import {
  canUserPerform,
  getAvailableTransitions,
  getWorkflowTransitions,
} from "./workflow";

describe("workflow transitions", () => {
  it("memoria: residente puede enviar a revisión desde draft", () => {
    const t = getAvailableTransitions({
      kind: "memoria_valorizada",
      status: "draft",
      roles: ["residente_obra"],
    });
    expect(t.map((x) => x.action)).toEqual(["submitted"]);
  });

  it("memoria: supervisor puede aprobar u observar desde in_review", () => {
    const t = getAvailableTransitions({
      kind: "memoria_valorizada",
      status: "in_review",
      roles: ["supervisor_inspector"],
    });
    expect(t.map((x) => x.action).sort()).toEqual(["approved", "rejected"]);
  });

  it("memoria: supervisor NO puede actuar sobre draft", () => {
    const t = getAvailableTransitions({
      kind: "memoria_valorizada",
      status: "draft",
      roles: ["supervisor_inspector"],
    });
    expect(t).toHaveLength(0);
  });

  it("memoria: rechazo exige comentario", () => {
    const reject = getWorkflowTransitions("memoria_valorizada").find(
      (x) => x.action === "rejected",
    );
    expect(reject?.requiresComment).toBe(true);
  });

  it("valuation: residente revisa pending; supervisor aprueba reviewed", () => {
    const residente = getAvailableTransitions({
      kind: "valuation",
      status: "pending",
      roles: ["residente_obra"],
    });
    expect(residente.map((x) => x.action)).toContain("reviewed");

    const supervisor = getAvailableTransitions({
      kind: "valuation",
      status: "reviewed",
      roles: ["supervisor_inspector"],
    });
    expect(supervisor.map((x) => x.action)).toContain("approved");
  });

  it("valuation: entidad puede aprobar reviewed", () => {
    const t = getAvailableTransitions({
      kind: "valuation",
      status: "reviewed",
      roles: ["entidad_publica"],
    });
    expect(t.map((x) => x.action)).toContain("approved");
  });

  it("liquidation: solo entidad/representante/admin aprueban generated", () => {
    const supervisor = getAvailableTransitions({
      kind: "liquidation",
      status: "generated",
      roles: ["supervisor_inspector"],
    });
    expect(supervisor).toHaveLength(0);

    const entidad = getAvailableTransitions({
      kind: "liquidation",
      status: "generated",
      roles: ["entidad_publica"],
    });
    expect(entidad.map((x) => x.action)).toContain("approved");
  });

  it("global admin puede ejecutar cualquier transición disponible para el estado", () => {
    const t = getAvailableTransitions({
      kind: "liquidation",
      status: "generated",
      roles: [],
      isGlobalAdmin: true,
    });
    expect(t.map((x) => x.action).sort()).toEqual(["approved", "rejected"]);
  });

  it("admin_proyecto cubre los tres pasos", () => {
    const adminRoles = ["admin_proyecto" as const];
    const subm = getAvailableTransitions({ kind: "memoria_valorizada", status: "draft", roles: adminRoles });
    const appr = getAvailableTransitions({ kind: "memoria_valorizada", status: "in_review", roles: adminRoles });
    expect(subm.length).toBeGreaterThan(0);
    expect(appr.length).toBeGreaterThan(0);
  });

  it("canUserPerform respeta isGlobalAdmin", () => {
    const tr = getWorkflowTransitions("valuation").find((x) => x.action === "approved")!;
    expect(canUserPerform(tr, ["residente_obra"])).toBe(false);
    expect(canUserPerform(tr, ["residente_obra"], true)).toBe(true);
  });
});
