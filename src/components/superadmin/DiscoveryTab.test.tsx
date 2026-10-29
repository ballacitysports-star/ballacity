// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const stats = {
  leads: 0,
  pagesRead: 0,
  pagesSkipped: 0,
  candidates: 0,
  duplicates: 0,
  errors: 0,
  aiCalls: 0,
};
const baseRun = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "running" as const,
  areaLabel: "Atlanta, GA",
  types: ["gym", "team", "coach"],
  tasksLeft: 5,
  pagesLeft: 0,
  pagesDone: 0,
  maxPages: 80,
  stats,
  log: [] as string[],
  error: null,
  startedAt: "2026-10-21T12:00:00Z",
  finishedAt: null,
  busy: false,
};

const row = (over: Record<string, unknown>) => ({
  id: "c1",
  subject_type: "gym",
  name: "Peach State Hoops",
  city: "Atlanta",
  state: "GA",
  address: "12 Court St",
  website: "https://peachhoops.com/",
  sports: ["Basketball"],
  category: "Indoor courts",
  description: "Indoor courts for leagues.",
  source: "search",
  source_url: "https://peachhoops.com/about",
  confidence: 0.9,
  duplicate_of: null,
  status: "pending",
  reject_reason: null,
  created_listing_id: null,
  created_at: "2026-10-21T12:00:00Z",
  ...over,
});

const overview = vi.fn();
const start = vi.fn();
const step = vi.fn();
const cancel = vi.fn();
const list = vi.fn();
const review = vi.fn();
const bulk = vi.fn();
const ids = vi.fn();

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/discovery.functions", () => ({
  superadminDiscoveryOverview: (a: unknown) => overview(a),
  superadminDiscoveryStart: (a: unknown) => start(a),
  superadminDiscoveryStep: (a: unknown) => step(a),
  superadminDiscoveryCancel: (a: unknown) => cancel(a),
  superadminDiscoveryList: (a: unknown) => list(a),
  superadminDiscoveryReview: (a: unknown) => review(a),
  superadminDiscoveryBulk: (a: unknown) => bulk(a),
  superadminDiscoveryIds: (a: unknown) => ids(a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { DiscoveryTab } from "./DiscoveryTab";

const counts = { pending: 3, approved: 0, rejected: 0 };

beforeEach(() => {
  overview.mockResolvedValue({
    areas: [{ id: "atlanta", label: "Atlanta, GA" }],
    searchEnabled: true,
    run: null,
  });
  list.mockResolvedValue({ rows: [], total: 0, counts });
  review.mockResolvedValue({ ok: true });
  bulk.mockResolvedValue({ done: 1, skipped: 0, failed: [] });
  ids.mockResolvedValue({ ids: [], total: 0, max: 500 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DiscoveryTab />
    </QueryClientProvider>,
  );
}

describe("DiscoveryTab: running a discovery", () => {
  it("starts a run for the chosen types and keeps stepping until it is done", async () => {
    start.mockResolvedValue({ ...baseRun });
    step
      .mockResolvedValueOnce({
        ...baseRun,
        tasksLeft: 2,
        pagesLeft: 4,
        stats: { ...stats, leads: 4 },
      })
      .mockResolvedValueOnce({
        ...baseRun,
        status: "done",
        tasksLeft: 0,
        pagesDone: 4,
        stats: { ...stats, candidates: 7 },
      });
    renderTab();

    fireEvent.click(await screen.findByLabelText("Trainers"));
    fireEvent.click(screen.getByRole("button", { name: "Start discovery" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0][0]).toEqual({
      data: { areaId: "atlanta", types: ["gym", "team"], maxPages: 80 },
    });

    await waitFor(() => expect(step).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(step.mock.calls[0][0]).toEqual({ data: { runId: baseRun.id } });
    expect(await screen.findByText("done")).toBeTruthy();
    expect(screen.getByText(/7 new\s+finds/)).toBeTruthy();
    // Finished runs are not stepped again.
    await new Promise((r) => setTimeout(r, 600));
    expect(step).toHaveBeenCalledTimes(2);
  });

  it("says when web search is off, and stops stepping after an error", async () => {
    overview.mockResolvedValue({
      areas: [{ id: "atlanta", label: "Atlanta, GA" }],
      searchEnabled: false,
      run: null,
    });
    start.mockResolvedValue({ ...baseRun });
    step.mockRejectedValue(new Error("boom"));
    renderTab();
    expect(await screen.findByText(/Web search: off/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start discovery" }));
    await waitFor(() => expect(step).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // The run is paused, not looping on a failing call, and can be resumed.
    expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 600));
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("shows the latest run on load without starting to step it", async () => {
    overview.mockResolvedValue({
      areas: [{ id: "atlanta", label: "Atlanta, GA" }],
      searchEnabled: true,
      run: { ...baseRun, pagesDone: 12, log: ["peachhoops.com: 1 found"] },
    });
    renderTab();
    expect(await screen.findByText("Paused")).toBeTruthy();
    expect(screen.getByText("peachhoops.com: 1 found")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 500));
    expect(step).not.toHaveBeenCalled();
    cancel.mockResolvedValue({ ...baseRun, status: "cancelled" });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ data: { runId: baseRun.id } }));
  });
});

describe("DiscoveryTab: reviewing finds", () => {
  const sure = row({ id: "c1", name: "Sure Gym" });
  const unsure = row({ id: "c2", name: "Unsure Gym", confidence: 0.5 });
  const repeat = row({
    id: "c3",
    name: "Repeat Gym",
    duplicate_of: { kind: "gym", id: "g9", name: "Repeat Gym Academy", score: 0.82 },
  });

  it("approves a find, and asks first when it may repeat a listing", async () => {
    list.mockResolvedValue({ rows: [sure, repeat], total: 2, counts });
    const confirm = vi.spyOn(window, "confirm");
    renderTab();

    const sureCard = (await screen.findByText("Sure Gym")).closest("li")!;
    fireEvent.click(within(sureCard).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(review).toHaveBeenCalledTimes(1));
    expect(review.mock.calls[0][0]).toEqual({
      data: { id: "c1", action: "approve", edits: undefined, confirmDuplicate: false },
    });

    const repeatCard = screen.getByText("Repeat Gym").closest("li")!;
    expect(
      within(repeatCard).getByText(/May repeat .Repeat Gym Academy. \(already listed, 82% match\)/),
    ).toBeTruthy();
    confirm.mockReturnValueOnce(false);
    fireEvent.click(within(repeatCard).getByRole("button", { name: "Approve" }));
    expect(review).toHaveBeenCalledTimes(1); // declined, nothing sent
    confirm.mockReturnValueOnce(true);
    fireEvent.click(within(repeatCard).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(review).toHaveBeenCalledTimes(2));
    expect(review.mock.calls[1][0]).toEqual({
      data: { id: "c3", action: "approve", edits: undefined, confirmDuplicate: true },
    });
  });

  it("rejects a find", async () => {
    list.mockResolvedValue({ rows: [sure], total: 1, counts });
    renderTab();
    const card = (await screen.findByText("Sure Gym")).closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(review).toHaveBeenCalledWith({ data: { id: "c1", action: "reject" } }),
    );
  });

  it("approves with the reviewer's corrections", async () => {
    list.mockResolvedValue({ rows: [sure], total: 1, counts });
    renderTab();
    const card = (await screen.findByText("Sure Gym")).closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: /Edit/ }));
    fireEvent.change(await screen.findByDisplayValue("Sure Gym"), {
      target: { value: "Sure Gym ATL" },
    });
    fireEvent.change(screen.getByDisplayValue("12 Court St"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve with these details" }));
    await waitFor(() => expect(review).toHaveBeenCalledTimes(1));
    expect(review.mock.calls[0][0]).toEqual({
      data: {
        id: "c1",
        action: "approve",
        edits: {
          name: "Sure Gym ATL",
          city: "Atlanta",
          address: null,
          website: "https://peachhoops.com/",
          category: "Indoor courts",
        },
        confirmDuplicate: false,
      },
    });
  });

  it("offers bulk approval only for the confident, non-repeating finds that are selected", async () => {
    list.mockResolvedValue({ rows: [sure, unsure, repeat], total: 3, counts });
    renderTab();
    await screen.findByText("Sure Gym");
    for (const name of ["Sure Gym", "Unsure Gym", "Repeat Gym"]) {
      fireEvent.click(screen.getByLabelText(`Select ${name}`));
    }
    expect(screen.getByText("3 selected")).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve high-confidence" });
    fireEvent.click(approve);
    await waitFor(() => expect(bulk).toHaveBeenCalledTimes(1));
    expect(bulk.mock.calls[0][0]).toEqual({ data: { ids: ["c1", "c2", "c3"], action: "approve" } });
  });

  it("filters by status and type", async () => {
    list.mockResolvedValue({
      rows: [],
      total: 0,
      counts: { pending: 0, approved: 2, rejected: 1 },
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Approved/ }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ status: "approved" }),
      }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Trainers" }).at(-1)!);
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ status: "approved", type: "coach" }),
      }),
    );
  });
});

describe("DiscoveryTab: select all and removing approved listings", () => {
  const approved = (n: number, over: Record<string, unknown> = {}) =>
    row({
      id: `a${n}`,
      name: `Approved Gym ${n}`,
      status: "approved",
      created_listing_id: `listing-${n}`,
      ...over,
    });
  const approvedCounts = { pending: 0, approved: 3, rejected: 0 };

  async function openApproved(rows: unknown[], total = rows.length) {
    list.mockImplementation(async ({ data }: { data: { status: string } }) =>
      data.status === "approved"
        ? { rows, total, counts: approvedCounts }
        : { rows: [], total: 0, counts: approvedCounts },
    );
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Approved/ }));
    await screen.findByText("Approved Gym 1");
  }

  it("selects every find on the page, and deselects them again", async () => {
    await openApproved([approved(1), approved(2), approved(3)]);
    const all = screen.getByLabelText("Select all on this page") as HTMLInputElement;
    expect(all.checked).toBe(false);
    fireEvent.click(all);
    for (const n of [1, 2, 3]) {
      expect((screen.getByLabelText(`Select Approved Gym ${n}`) as HTMLInputElement).checked).toBe(
        true,
      );
    }
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(all.checked).toBe(true);
    fireEvent.click(all);
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it("offers every match across pages, capped by the server", async () => {
    await openApproved([approved(1), approved(2), approved(3)], 120);
    ids.mockResolvedValue({
      ids: Array.from({ length: 100 }, (_, i) => `x${i}`),
      total: 120,
      max: 100,
    });
    expect(screen.queryByRole("button", { name: /Select all 120 matching/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Select all on this page"));
    fireEvent.click(screen.getByRole("button", { name: "Select all 120 matching" }));
    await waitFor(() => expect(screen.getByText("100 selected")).toBeTruthy());
    expect(ids).toHaveBeenCalledWith({ data: { status: "approved", type: undefined, search: "" } });
  });

  it("only offers to select an approved find while its listing exists", async () => {
    await openApproved([approved(1), approved(2, { created_listing_id: null })]);
    expect(screen.getByLabelText("Select Approved Gym 1")).toBeTruthy();
    expect(screen.queryByLabelText("Select Approved Gym 2")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Remove listing" })).toHaveLength(1);
  });

  it("removes one approved listing after confirming", async () => {
    await openApproved([approved(1)]);
    review.mockResolvedValue({ ok: true });
    expect(screen.getByRole("link", { name: /View listing/ }).getAttribute("href")).toBe(
      "/orgs/listing-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove listing" }));
    expect(review).not.toHaveBeenCalled(); // asks first
    expect(await screen.findByText("Remove this listing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(review).toHaveBeenCalledTimes(1));
    expect(review.mock.calls[0][0]).toEqual({ data: { id: "a1", action: "remove" } });
  });

  it("links a team or trainer to its team page", async () => {
    await openApproved([approved(1, { subject_type: "coach", created_listing_id: "coach-dre" })]);
    expect(screen.getByRole("link", { name: /View listing/ }).getAttribute("href")).toBe(
      "/teams/coach-dre",
    );
  });

  it("removes selected listings only after typing REMOVE", async () => {
    await openApproved([approved(1), approved(2), approved(3)]);
    bulk.mockResolvedValue({
      done: 2,
      skipped: 0,
      failed: [{ name: "Approved Gym 3", error: "People have started using this listing" }],
    });
    fireEvent.click(screen.getByLabelText("Select all on this page"));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected listings" }));
    expect(await screen.findByText("Remove 3 listings")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "remove" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(bulk).toHaveBeenCalledTimes(1));
    expect(bulk.mock.calls[0][0]).toEqual({ data: { ids: ["a1", "a2", "a3"], action: "remove" } });
  });

  it("sends a large selection in batches the server accepts", async () => {
    await openApproved([approved(1)], 120);
    const many = Array.from({ length: 120 }, (_, i) => `id-${i}`);
    ids.mockResolvedValue({ ids: many, total: 120, max: 500 });
    bulk.mockResolvedValue({ done: 50, skipped: 0, failed: [] });
    fireEvent.click(screen.getByLabelText("Select all on this page"));
    fireEvent.click(await screen.findByRole("button", { name: "Select all 120 matching" }));
    await waitFor(() => expect(screen.getByText("120 selected")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove selected listings" }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "REMOVE" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(bulk).toHaveBeenCalledTimes(3));
    expect(
      bulk.mock.calls.map(([a]) => (a as { data: { ids: string[] } }).data.ids.length),
    ).toEqual([50, 50, 20]);
  });

  it("selects pending finds the same way, and clears the selection when the filter changes", async () => {
    list.mockResolvedValue({
      rows: [row({ id: "p1", name: "Pending One" }), row({ id: "p2", name: "Pending Two" })],
      total: 2,
      counts,
    });
    renderTab();
    await screen.findByText("Pending One");
    fireEvent.click(screen.getByLabelText("Select all on this page"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve high-confidence" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove selected listings" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Trainers" }).at(-1)!);
    await waitFor(() => expect(screen.queryByText("2 selected")).toBeNull());
  });
});
