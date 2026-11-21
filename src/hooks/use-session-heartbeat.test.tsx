// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The heartbeat follows the signed-in member, not the auth state object: a
 * re-published state for the same member (supabase-js re-emits SIGNED_IN
 * whenever a tab opens or becomes visible) must not send another heartbeat.
 */

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  beat: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.beat }));
vi.mock("@/lib/session-activity.functions", () => ({ recordSessionHeartbeat: {} }));

import { useSessionHeartbeat } from "@/hooks/use-session-heartbeat";

describe("useSessionHeartbeat", () => {
  beforeEach(() => {
    h.user = null;
    h.beat.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("sends one heartbeat per member, not per re-published user object", () => {
    h.user = { id: "member" };
    const { rerender } = renderHook(() => useSessionHeartbeat());
    expect(h.beat).toHaveBeenCalledTimes(1);

    h.user = { id: "member" };
    rerender();
    h.user = { id: "member" };
    rerender();
    expect(h.beat).toHaveBeenCalledTimes(1);

    h.user = { id: "other" };
    rerender();
    expect(h.beat).toHaveBeenCalledTimes(2);
  });

  it("sends nothing while signed out", () => {
    renderHook(() => useSessionHeartbeat());
    expect(h.beat).not.toHaveBeenCalled();
  });
});
