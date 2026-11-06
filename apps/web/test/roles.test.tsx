import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoutes } from "../src/App";
import { canManageMembers, canSeeAudit, navFor } from "../src/lib/roles";
import { MembersScreen } from "../src/screens/MembersScreen";
import { renderAs } from "./helpers";

afterEach(cleanup);

describe("role-based visibility", () => {
  it("front desk sees 'Nuevo socio' and the status control", async () => {
    renderAs("front_desk", <MembersScreen />);
    await screen.findByText("Socio Demo Uno");
    const btn = screen.getByRole("button", { name: "Nuevo socio" });
    expect(btn.getAttribute("data-tour-id")).toBe("member-new");
    expect(document.querySelector('[data-tour-id="member-status"]')).not.toBeNull();
  });

  it("trainer does not see 'Nuevo socio' nor the status control", async () => {
    renderAs("trainer", <MembersScreen />);
    await screen.findByText("Socio Demo Uno");
    expect(screen.queryByRole("button", { name: "Nuevo socio" })).toBeNull();
    expect(document.querySelector('[data-tour-id="member-status"]')).toBeNull();
  });

  it("hides Auditoría from the trainer and shows it to the owner", async () => {
    renderAs("trainer", <AppRoutes />, "/staff/members");
    const nav = await screen.findByRole("navigation");
    expect(nav.textContent).toContain("Socios");
    expect(nav.textContent).not.toContain("Auditoría");
    cleanup();

    renderAs("owner", <AppRoutes />, "/staff/members");
    const ownerNav = await screen.findByRole("navigation");
    expect(ownerNav.textContent).toContain("Auditoría");
  });

  it("does not route the trainer to the audit screen even by URL", async () => {
    renderAs("trainer", <AppRoutes />, "/staff/audit");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Socios"),
    );
  });

  it("members get the portal, not the staff console", async () => {
    renderAs("member", <AppRoutes />, "/staff/members");
    const nav = await screen.findByRole("navigation");
    expect(nav.textContent).toContain("Mi cuenta");
    expect(nav.textContent).toContain("Mis consentimientos");
    expect(nav.textContent).not.toContain("Socios");
  });

  it("role rules match the contract", () => {
    expect(["owner", "location_manager", "front_desk"].every(canManageMembers)).toBe(true);
    expect(["trainer", "accountant", "member", "guardian"].some(canManageMembers)).toBe(false);
    expect(canSeeAudit("owner") && canSeeAudit("location_manager")).toBe(true);
    expect(canSeeAudit("front_desk") || canSeeAudit("trainer")).toBe(false);
    expect(navFor("guardian").map((n) => n.label)).toEqual(["nav.myAccount", "nav.myConsents"]);
  });
});
