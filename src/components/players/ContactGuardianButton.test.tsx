// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// A minor's player card, opened from a shared link with a query and hash.
const here = vi.hoisted(() => ({ href: "/player-card/kid1?clip=c9#reels" }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useLocation: ({ select }: { select: (l: { href: string }) => unknown }) => select(here),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: null } }) }, rpc },
}));

import { ContactGuardianButton } from "./ContactGuardianButton";

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

describe("ContactGuardianButton, signed out", () => {
  it("sends the visitor to sign in and back to this player card", async () => {
    render(<ContactGuardianButton childId="kid1" childName="Sam" />);
    fireEvent.click(screen.getByRole("button", { name: "Contact guardian" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith({
      to: "/auth",
      search: { next: "/player-card/kid1?clip=c9#reels" },
    });
    // Nothing about the child's guardian is looked up for a signed-out visitor.
    expect(rpc).not.toHaveBeenCalled();
  });
});
