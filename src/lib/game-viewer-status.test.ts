import { describe, expect, it, vi } from "vitest";
import type { GamePaymentSettings, JoinRequest, PaymentSubmission } from "@/lib/payments";

/**
 * Contract: the game page gets the settings row (which decides the join button)
 * as soon as it arrives, even while the viewer's own submissions or join request
 * are still being read. It used to wait for all three, so one slow optional read
 * left the button on the "request to join" default.
 */

vi.mock("@/lib/payments", () => ({
  getGamePaymentSettings: vi.fn(),
  listMySubmissionsForGame: vi.fn(),
  getMyJoinRequest: vi.fn(),
}));

const { loadGameViewerStatus } = await import("@/lib/game-viewer-status");

const SETTINGS = { game_id: "g2", requires_approval: false, entry_fee: 10 } as GamePaymentSettings;
const SUBS = [{ id: "s1", status: "pending" }] as PaymentSubmission[];
const REQ = { id: "r1", status: "approved" } as JoinRequest;
const never = <T>() => new Promise<T>(() => {});

describe("loadGameViewerStatus", () => {
  it("hands over the settings while the viewer's own reads still hang", async () => {
    const onSettings = vi.fn();
    void loadGameViewerStatus("g2", onSettings, {
      getSettings: async () => SETTINGS,
      listMySubmissions: () => never(),
      getMyRequest: () => never(),
    });
    await vi.waitFor(() => expect(onSettings).toHaveBeenCalledWith(SETTINGS));
  });

  it("resolves with all three once they have all answered", async () => {
    const onSettings = vi.fn();
    const status = await loadGameViewerStatus("g2", onSettings, {
      getSettings: async () => SETTINGS,
      listMySubmissions: async () => SUBS,
      getMyRequest: async () => REQ,
    });
    expect(status).toEqual({ settings: SETTINGS, subs: SUBS, req: REQ });
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("hands over a missing settings row as null (the caller keeps its approval default)", async () => {
    const onSettings = vi.fn();
    await loadGameViewerStatus("g2", onSettings, {
      getSettings: async () => null,
      listMySubmissions: async () => [],
      getMyRequest: async () => null,
    });
    expect(onSettings).toHaveBeenCalledWith(null);
  });

  it("still rejects when a read fails, without inventing settings", async () => {
    const onSettings = vi.fn();
    await expect(
      loadGameViewerStatus("g2", onSettings, {
        getSettings: async () => {
          throw new Error("settings down");
        },
        listMySubmissions: async () => SUBS,
        getMyRequest: async () => REQ,
      }),
    ).rejects.toThrow("settings down");
    expect(onSettings).not.toHaveBeenCalled();

    await expect(
      loadGameViewerStatus("g2", onSettings, {
        getSettings: async () => SETTINGS,
        listMySubmissions: async () => {
          throw new Error("subs down");
        },
        getMyRequest: async () => REQ,
      }),
    ).rejects.toThrow("subs down");
    // The settings it did read still reached the page.
    expect(onSettings).toHaveBeenCalledWith(SETTINGS);
  });
});
