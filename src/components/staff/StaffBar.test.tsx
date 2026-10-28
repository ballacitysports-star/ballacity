// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const h = vi.hoisted(() => ({ pathname: "/feed" }));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ state: { location: { pathname: h.pathname } } }),
}));
vi.mock("@/components/staff/StaffSwitcher", () => ({
  StaffSwitcher: () => <button>Superadmin</button>,
}));
vi.mock("@/hooks/use-staff-access", () => ({ useStaffAccess: () => ({ access: {} }) }));
vi.mock("@/lib/staff", () => ({ showsStaffChrome: () => true }));

import { StaffBar } from "./StaffBar";

afterEach(cleanup);

describe("StaffBar", () => {
  it("shows on ordinary pages", () => {
    h.pathname = "/feed";
    const { container } = render(<StaffBar />);
    expect(container.textContent).toContain("Superadmin");
  });

  it("stays out of a conversation, which needs the whole top of the screen", () => {
    h.pathname = "/messages/6f1c2d3e-0000-4000-8000-123456789abc";
    const { container } = render(<StaffBar />);
    expect(container.innerHTML).toBe("");
  });

  it("still shows on the inbox list", () => {
    h.pathname = "/messages";
    const { container } = render(<StaffBar />);
    expect(container.textContent).toContain("Superadmin");
  });
});
