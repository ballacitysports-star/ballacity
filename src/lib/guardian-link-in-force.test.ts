import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const limit = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.limit = () => limit();
      return q;
    },
  },
}));

import { fetchHasGuardianLinkInForce } from "./guardian-link-in-force";

beforeEach(() => {
  rpc.mockReset();
  limit.mockReset();
});

describe("fetchHasGuardianLinkInForce", () => {
  it("trusts the database rule: an adult whose link still says active has none in force", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    limit.mockResolvedValue({ data: [{ id: "l1" }] });
    expect(await fetchHasGuardianLinkInForce("u1")).toBe(false);
    expect(rpc).toHaveBeenCalledWith("my_guardian_link_in_force");
    expect(limit).not.toHaveBeenCalled();
  });

  it("says yes for a minor with a link in force", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await fetchHasGuardianLinkInForce("u1")).toBe(true);
  });

  it("reads the member's active links when the rule is missing (a minor's prompts stay on)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    limit.mockResolvedValue({ data: [{ id: "l1" }] });
    expect(await fetchHasGuardianLinkInForce("u1")).toBe(true);
    limit.mockResolvedValue({ data: [] });
    expect(await fetchHasGuardianLinkInForce("u1")).toBe(false);
  });
});
