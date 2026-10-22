// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
  data: "c1",
  error: null,
}));
let myClaim: Record<string, unknown> | null = null;

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit"]) chain[k] = () => chain;
  chain.maybeSingle = async () => ({ data: myClaim, error: null });
  return {
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
      from: () => chain,
    },
  };
});

import { ClaimListingCard } from "./ClaimListingCard";
import { listingErrorMessage } from "@/lib/listings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  myClaim = null;
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ClaimListingCard subjectType="team" subjectId="t1" name="Eastside Hoops" />
    </QueryClientProvider>,
  );
}

describe("ClaimListingCard", () => {
  it("needs a stated connection and an attestation before a claim can be sent", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /Claim this team/ }));
    const send = screen.getByRole("button", { name: "Send claim" }) as HTMLButtonElement;

    fireEvent.change(screen.getByLabelText("Why is this yours?"), {
      target: { value: "I have coached this team for three seasons." },
    });
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Your connection"), { target: { value: "coach" } });
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(send.disabled).toBe(false);

    // The card says what a claim does not grant.
    expect(screen.getByText(/doesn't give anyone access to a\s+Facebook Page/)).toBeTruthy();

    fireEvent.click(send);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0]).toEqual([
      "submit_listing_claim_details",
      {
        _type: "team",
        _id: "t1",
        _relationship: "coach",
        _attest: true,
        _message: "I have coached this team for three seasons.",
        _evidence: null,
      },
    ]);
  });

  it("shows the moderator's question and sends the claimant's answer", async () => {
    myClaim = {
      id: "c9",
      status: "needs_info",
      denial_reason: null,
      info_request: "Link the league roster that lists you.",
      created_at: "2026-10-21T10:00:00Z",
    };
    renderCard();
    expect(await screen.findByText("Link the league roster that lists you.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Here it is" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0]).toEqual([
      "respond_listing_claim",
      { _claim: "c9", _message: "Here it is", _evidence: null },
    ]);
  });
});

describe("listingErrorMessage", () => {
  it("explains the new claim refusals", () => {
    expect(listingErrorMessage(new Error("OWN_CLAIM"))).toMatch(/another moderator/i);
    expect(listingErrorMessage(new Error("ATTESTATION_REQUIRED"))).toMatch(/accurate/);
    expect(listingErrorMessage(new Error("RELATIONSHIP_REQUIRED"))).toMatch(/connected/);
    expect(listingErrorMessage(new Error("CLAIM_NOT_AWAITING_INFO"))).toMatch(/isn't waiting/);
  });
});
