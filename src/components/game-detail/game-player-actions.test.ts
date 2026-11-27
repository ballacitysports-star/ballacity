import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * blockPlayer's toasts. A failed block says what had already gone through: a decline for the request rows'
 * Block (the default, so HostRequestRows keeps its words) and a removal for the roster row's Remove and block.
 */
const env = vi.hoisted(() => ({
  blockUser: vi.fn(async (): Promise<void> => undefined),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: env.toast }));
vi.mock("@/lib/moderation", () => ({ blockUser: env.blockUser }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { blockPlayer } from "./game-player-actions";

// A plain failure with no catalog sentence, so the fallback shows.
const failure = new Error("something broke");

afterEach(() => {
  vi.clearAllMocks();
});

describe("blockPlayer", () => {
  it("says the player is blocked when the block goes through", async () => {
    await blockPlayer("p1", "Pat", "removed");
    expect(env.blockUser).toHaveBeenCalledWith("p1");
    expect(env.toast.success).toHaveBeenCalledWith("Pat blocked.");
    expect(env.toast.error).not.toHaveBeenCalled();
  });

  it("keeps the decline wording by default", async () => {
    env.blockUser.mockRejectedValueOnce(failure);
    await blockPlayer("p1", "Pat");
    expect(env.toast.error).toHaveBeenCalledWith(
      "Declined, but couldn't block Pat. Try again from their profile.",
    );
    expect(env.toast.success).not.toHaveBeenCalled();
  });

  it("says the removal went through when the block after a removal fails", async () => {
    env.blockUser.mockRejectedValueOnce(failure);
    await blockPlayer("p1", "Pat", "removed");
    expect(env.toast.error).toHaveBeenCalledWith(
      "Removed, but couldn't block Pat. Try again from their profile.",
    );
    expect(env.toast.success).not.toHaveBeenCalled();
  });
});
