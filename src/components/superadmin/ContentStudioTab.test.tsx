// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const DRAFT_ID = "22222222-2222-4222-8222-222222222222";

function overview(over: Record<string, unknown> = {}) {
  return {
    canApprove: true,
    settings: { discovery: true, aiDrafts: true, publishing: false, listingCreation: true },
    metaReady: false,
    sources: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        url: "https://m.facebook.com/x/posts/1",
        normalized_url: "https://facebook.com/x/posts/1",
        url_host: "facebook.com",
        platform: "facebook",
        source_kind: "post",
        status: "needs_details",
        opportunity: null,
        title: "Sunday run",
        summary: null,
        sport: "Basketball",
        city: null,
        location: null,
        event_starts_at: null,
        age_group: null,
        listing_kind: "pickup_game",
        org_name: null,
        details_verified: { title: "verified" },
        linked_subject_type: null,
        linked_subject_id: null,
        notes: null,
        created_at: "2026-10-21T10:00:00Z",
      },
    ],
    drafts: [
      {
        id: DRAFT_ID,
        source_id: "11111111-1111-4111-8111-111111111111",
        kind: "pickup_game",
        message: "Pickup run Sunday!",
        link_url: null,
        hashtags: ["BallaCity"],
        facts: [{ claim: "Sunday", status: "suggested" }],
        source_attribution: "Source: https://m.facebook.com/x/posts/1",
        ai_generated: true,
        status: "in_review",
        version: 3,
        approval_id: null,
        rejection_reason: null,
        updated_at: "2026-10-21T10:00:00Z",
      },
    ],
    attempts: [],
    pages: [],
    ...over,
  };
}

const load = vi.fn(async () => overview());
const approve = vi.fn(async (_: unknown) => ({ approvalId: "a1" }));
const submit = vi.fn(async (_: unknown) => ({ source: overview().sources[0], duplicate: true }));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/content-studio.functions", () => ({
  studioOverview: () => load(),
  approveStudioDraft: (a: unknown) => approve(a),
  submitStudioSource: (a: unknown) => submit(a),
  createStudioDraft: vi.fn(),
  disconnectMetaPage: vi.fn(),
  generateStudioDraftWithAi: vi.fn(),
  linkStudioSourceToListing: vi.fn(),
  publishStudioDraft: vi.fn(),
  rejectStudioDraft: vi.fn(),
  setStudioDestinationPage: vi.fn(),
  startMetaConnect: vi.fn(),
  updateStudioDraft: vi.fn(),
  updateStudioSettings: vi.fn(),
  updateStudioSource: vi.fn(),
}));
vi.mock("@/lib/listings.functions", () => ({ createUnclaimedListing: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ContentStudioTab } from "./ContentStudioTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  load.mockImplementation(async () => overview());
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ContentStudioTab />
    </QueryClientProvider>,
  );
}

async function openDraft() {
  fireEvent.mouseDown(await screen.findByRole("tab", { name: /Drafts/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Open" }));
  return screen.findByRole("dialog");
}

describe("ContentStudioTab", () => {
  it("lists sources with their verification state and says links are never read", async () => {
    renderTab();
    expect(await screen.findByText("Sunday run")).toBeTruthy();
    expect(screen.getByText("Needs details")).toBeTruthy();
    expect(screen.getByText("1/3 details verified")).toBeTruthy();
    expect(screen.getByText(/never reads, copies or republishes the post/)).toBeTruthy();
    // Meta numbers are labelled unavailable, never estimated.
    expect(screen.getByText(/those numbers are unavailable rather than/)).toBeTruthy();
  });

  it("reports a duplicate submission instead of creating a second record", async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText("Source link"), {
      target: { value: "https://www.facebook.com/x/posts/1?fbclid=1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add source/ }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });

  it("will not approve without a destination Page", async () => {
    renderTab();
    const dialog = await openDraft();
    expect(within(dialog).getByText(/Set a destination Page/)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Approve v3" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("needs an explicit acknowledgement to approve unverified facts, and approves the version shown", async () => {
    load.mockImplementation(async () =>
      overview({
        pages: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            page_id: "123",
            page_name: "BallaCity",
            is_destination: true,
            status: "active",
            granted_scopes: [],
            last_error: null,
            connected_at: "2026-10-21T10:00:00Z",
          },
        ],
      }),
    );
    renderTab();
    const dialog = await openDraft();
    const approveBtn = within(dialog).getByRole("button", { name: "Approve v3" }) as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(approveBtn.disabled).toBe(false);
    fireEvent.click(approveBtn);
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(approve.mock.calls[0][0]).toEqual({
      data: { id: DRAFT_ID, version: 3, acknowledgeUnverified: true },
    });
  });

  it("hides approval from staff who are not superadmins", async () => {
    load.mockImplementation(async () => overview({ canApprove: false }));
    renderTab();
    const dialog = await openDraft();
    expect(within(dialog).queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  it("explains that publishing is unavailable without the Meta app", async () => {
    renderTab();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Page & settings/ }));
    expect(await screen.findByText(/approved through Meta App Review/)).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Publishing" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Connect Facebook/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
