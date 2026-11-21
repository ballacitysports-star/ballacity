// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * "I'm available" posts exactly what was picked, prefilled from the profile, and respects the posting gate.
 */
const mocks = vi.hoisted(() => ({
  createAvailability: vi.fn(async (_payload: unknown) => "new-id"),
  gate: { loading: false, canPost: true, reason: null as string | null },
  toastError: vi.fn(),
}));
vi.mock("@/lib/availability", () => ({ createAvailability: mocks.createAvailability }));
vi.mock("@/lib/availability-gate", () => ({
  useAvailabilityGate: () => mocks.gate,
  availabilityGateMessage: () => "Finish your player profile first.",
}));
vi.mock("@/lib/user-prefs-store", () => ({
  useMyProfile: () => ({
    sports: [{ name: "Basketball", level: { system: "Level", tier: "Rec League" } }],
    city: "Buford, GA",
  }),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));

import { QuickAvailabilitySheet } from "./QuickAvailabilitySheet";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.gate.canPost = true;
});

function open(onPosted = vi.fn()) {
  render(<QuickAvailabilitySheet open onOpenChange={() => {}} onPosted={onPosted} />);
  return onPosted;
}

describe("QuickAvailabilitySheet", () => {
  it("tomorrow morning, every week: one weekly slot with the profile's sport, level and city", async () => {
    const onPosted = open();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(screen.getByRole("button", { name: "Morning" }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Post availability" }));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(mocks.createAvailability).toHaveBeenCalledWith({
      sports: ["Basketball"],
      skill_level: "Rec League",
      skill_levels: { Basketball: "Rec League" },
      looking_for: ["pickup"],
      time_slots: [{ weekday: tomorrow.getDay(), start: "06:00", end: "11:00" }],
      city: "Buford, GA",
      travel_radius_km: 40,
    });
  });

  it("shows the sport being posted even when the profile has only one", () => {
    open();
    expect(screen.getByRole("button", { name: "Basketball", pressed: true })).toBeTruthy();
  });

  it("intents can be changed: drop pickup, add guest", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(screen.getByRole("button", { name: "Pickup" }));
    fireEvent.click(screen.getByRole("button", { name: "Guest player" }));
    fireEvent.click(screen.getByRole("button", { name: "Post availability" }));
    await waitFor(() => expect(mocks.createAvailability).toHaveBeenCalled());
    expect(mocks.createAvailability.mock.calls[0][0]).toMatchObject({ looking_for: ["guest"] });
  });

  it("refuses when the posting gate is closed, without posting", async () => {
    mocks.gate.canPost = false;
    open();
    fireEvent.click(screen.getByRole("button", { name: "Post availability" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Finish your player profile first."),
    );
    expect(mocks.createAvailability).not.toHaveBeenCalled();
  });

  it("shows a database refusal in plain words and stays open", async () => {
    mocks.createAvailability.mockRejectedValueOnce(
      new Error('new row violates row-level security policy for table "player_availabilities"'),
    );
    const onPosted = open();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(screen.getByRole("button", { name: "Post availability" }));
    // WP 4.0: the generic permission sentence, never the raw database text.
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("You don't have permission to do that."),
    );
    expect(onPosted).not.toHaveBeenCalled();
  });

  it("falls back to a plain sentence for an unknown failure", async () => {
    mocks.createAvailability.mockRejectedValueOnce(new Error("Couldn't save"));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(screen.getByRole("button", { name: "Post availability" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't post your availability. Please try again.",
      ),
    );
  });
});
