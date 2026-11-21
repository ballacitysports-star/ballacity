// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * "Your posts": each post says where it stands (listed until, paused, run out) and offers what fits: Pause or Resume,
 * and "Still available" for a weekly post that is running out or has run out.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/auth-return", () => ({ useAuthSearchHere: () => ({}) }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("./share-availability", () => ({ shareAvailability: vi.fn() }));
vi.mock("@/lib/game-invites", () => ({
  listMyPendingGameInvites: async () => [],
  respondToGameInvite: vi.fn(),
  gameInviteErrorMessage: () => "",
}));

const api = vi.hoisted(() => ({
  posts: [] as Record<string, unknown>[],
  listMyAvailabilities: vi.fn(),
  setAvailabilityPaused: vi.fn(async () => {}),
  reconfirmAvailability: vi.fn(async () => {}),
  deleteAvailability: vi.fn(async (_id: string) => {}),
}));
vi.mock("@/lib/availability", () => ({
  listMyAvailabilities: api.listMyAvailabilities,
  listMyContactRequests: async () => [],
  setContactRequestStatus: vi.fn(),
  deleteAvailability: api.deleteAvailability,
  setAvailabilityPaused: api.setAvailabilityPaused,
  reconfirmAvailability: api.reconfirmAvailability,
}));

import { MineView } from "./MineView";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const post = (id: string, over: Record<string, unknown>) => ({
  id,
  user_id: "me",
  sports: ["Basketball"],
  skill_level: "All Levels",
  skill_levels: {},
  looking_for: ["pickup"],
  time_slots: [{ weekday: 2, start: "18:00", end: "20:00" }],
  timezone: "America/New_York",
  city: "Buford",
  status: "open",
  last_confirmed_at: ago(1),
  created_at: ago(30),
  updated_at: ago(1),
  ...over,
});

beforeEach(() => {
  api.listMyAvailabilities.mockImplementation(async () => api.posts);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function rows() {
  render(<MineView user={{ id: "me" }} onEdit={() => {}} refreshKey={0} />);
  await waitFor(() =>
    expect(screen.getAllByTestId("my-availability").length).toBe(api.posts.length),
  );
  return screen.getAllByTestId("my-availability");
}

describe("MineView, your posts", () => {
  it("a fresh weekly post: listed, can be paused, no confirm needed", async () => {
    api.posts = [post("a", {})];
    const [row] = await rows();
    expect(within(row).getByText(/^Listed until /)).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Still available" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(api.setAvailabilityPaused).toHaveBeenCalledWith("a", true));
  });

  it("a paused post can be resumed", async () => {
    api.posts = [post("b", { status: "paused" })];
    const [row] = await rows();
    expect(within(row).getByText("Paused: only you can see it")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(api.setAvailabilityPaused).toHaveBeenCalledWith("b", false));
  });

  it("a weekly post that ran out asks to be confirmed, and confirming re-reads the posts", async () => {
    api.posts = [post("c", { last_confirmed_at: ago(20) })];
    const [row] = await rows();
    expect(within(row).getByText("Not listed: confirm you're still available")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Pause" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Still available" }));
    await waitFor(() => expect(api.reconfirmAvailability).toHaveBeenCalledWith("c", "open"));
    await waitFor(() => expect(api.listMyAvailabilities).toHaveBeenCalledTimes(2));
  });

  it("a weekly post about to run out offers the confirm while still listed", async () => {
    api.posts = [post("d", { last_confirmed_at: ago(12) })];
    const [row] = await rows();
    expect(within(row).getByRole("button", { name: "Still available" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("a dated post whose dates passed asks for new dates instead", async () => {
    api.posts = [post("e", { time_slots: [{ date: "2026-01-10", start: "18:00", end: "20:00" }] })];
    const [row] = await rows();
    expect(within(row).getByText("Not listed: your dates have passed")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Still available" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Pick new dates" })).toBeTruthy();
  });

  it("a post closed by BallaCity offers neither pause nor confirm", async () => {
    api.posts = [post("f", { status: "closed" })];
    const [row] = await rows();
    expect(within(row).getByText("Closed by BallaCity")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Pause" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Resume" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Still available" })).toBeNull();
  });

  it("every post action is a 44px tap target (WP 4.3)", async () => {
    api.posts = [post("g", { last_confirmed_at: ago(12) })];
    const [row] = await rows();
    for (const name of ["Still available", "Pause", "Edit", "Share", "Remove"]) {
      const b = within(row).getByRole("button", { name });
      expect(b.className.split(/\s+/)).toContain("min-h-11");
    }
  });
});

describe("MineView, removing a post (WP 4.3)", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
  });
  afterEach(() => confirmSpy.mockRestore());

  it("asks in an in-app dialog, never window.confirm, and Keep it removes nothing", async () => {
    api.posts = [post("r1", {})];
    const [row] = await rows();
    const opener = within(row).getByRole("button", { name: "Remove" });
    fireEvent.click(opener);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove this post?")).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
    // 44px confirm buttons (WP 4.3).
    for (const name of ["Keep it", "Remove post"])
      expect(within(dialog).getByRole("button", { name }).className.split(/\s+/)).toContain(
        "min-h-11",
      );
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.deleteAvailability).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("my-availability")).toHaveLength(1);
    // Focus goes back to the Remove button that opened the dialog, not to <body>.
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("removes the post once confirmed and closes the dialog", async () => {
    api.posts = [post("r2", {}), post("r3", {})];
    const [first] = await rows();
    fireEvent.click(within(first).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove post" }));
    await waitFor(() => expect(api.deleteAvailability).toHaveBeenCalledWith("r2"));
    await waitFor(() => expect(screen.getAllByTestId("my-availability")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(toastMock.success).toHaveBeenCalledWith("Post removed");
    // That post's Remove button is gone, so focus lands on the list heading.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your posts" })),
    );
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("on failure keeps the post and the dialog, and shows a friendly message, not the raw error", async () => {
    api.deleteAvailability.mockRejectedValueOnce(
      Object.assign(new Error('new row violates row-level security policy for table "x"'), {
        code: "42501",
      }),
    );
    api.posts = [post("r4", {})];
    const [row] = await rows();
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove post" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    const shown = String(toastMock.error.mock.calls[0]![0]);
    expect(shown).not.toMatch(/row-level security|42501|policy/i);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getAllByTestId("my-availability")).toHaveLength(1);
    expect(toastMock.success).not.toHaveBeenCalled();
    // Focus stayed in the dialog while the delete ran (the button was never disabled under it).
    expect(screen.getByRole("alertdialog").contains(document.activeElement)).toBe(true);
  });
});
