// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Org } from "@/lib/sample-data";

// The trainer page the visitor is on, with its query and hash.
const here = vi.hoisted(() => ({ href: "/trainers/t1?tab=book#sessions" }));
const nav = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => nav,
  useLocation: ({ select }: { select: (l: { href: string }) => unknown }) => select(here),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
const createTrainerSessionRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trainer-requests", () => ({
  createTrainerSessionRequest,
  cancelTrainerSessionRequest: vi.fn(),
  getMyPendingRequestForTrainer: vi.fn(async () => null),
  listTrainerBookedSlots: vi.fn(async () => []),
}));
vi.mock("@/lib/org-store", () => ({ ensureOrgOwnerId: vi.fn(async () => "owner") }));
vi.mock("@/components/NextAvailableList", () => ({ NextAvailableList: () => null }));

import { BookSessionSheet } from "./BookSessionSheet";

afterEach(() => {
  cleanup();
  nav.mockReset();
});

const org = { id: "t1", kind: "coach", name: "Coach Kim", ratePerHour: 0 } as unknown as Org;

describe("BookSessionSheet, signed out", () => {
  it("sends the visitor to sign in and back to this trainer page", () => {
    render(<BookSessionSheet org={org} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith({
      to: "/auth",
      search: { next: "/trainers/t1?tab=book#sessions" },
    });
    expect(createTrainerSessionRequest).not.toHaveBeenCalled();
  });
});
