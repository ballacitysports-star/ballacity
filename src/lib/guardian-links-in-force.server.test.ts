/* eslint-disable @typescript-eslint/no-explicit-any -- a hand-rolled in-memory Supabase stub */
import { describe, expect, it, vi } from "vitest";
import { guardianLinksInForce } from "./guardian-links-in-force.server";

const ROWS = [
  { parent_user_id: "mom", child_user_id: "kid", verified_at: "2026-10-01", status: "active" },
  { parent_user_id: "dad", child_user_id: "grown", verified_at: "2026-10-01", status: "active" },
  { parent_user_id: "old", child_user_id: "kid", verified_at: "2026-10-01", status: "revoked" },
];

function table(error: { message: string } | null = null) {
  const calls: string[] = [];
  return {
    calls,
    from: (t: string) => {
      calls.push(`from:${t}`);
      let rows = [...ROWS];
      const q: any = {
        select: () => q,
        in: (k: string, v: unknown[]) => ((rows = rows.filter((r: any) => v.includes(r[k]))), q),
        eq: (k: string, v: unknown) => ((rows = rows.filter((r: any) => r[k] === v)), q),
        then: (res: (v: unknown) => unknown) => res({ data: error ? null : rows, error }),
      };
      return q;
    },
  };
}

describe("guardianLinksInForce", () => {
  it("asks the database rule and returns what it says (a link to an 18-year-old is not in it)", async () => {
    const admin: any = table();
    admin.rpc = vi.fn(async () => ({
      data: [{ parent_user_id: "mom", child_user_id: "kid", verified_at: "2026-10-01" }],
      error: null,
    }));
    const out = await guardianLinksInForce(admin, ["kid", "grown", "kid"]);
    expect(admin.rpc).toHaveBeenCalledWith("guardian_links_in_force", {
      _children: ["kid", "grown"],
    });
    expect(out.error).toBeNull();
    expect(out.data!.map((l) => l.child_user_id)).toEqual(["kid"]);
    expect(admin.calls).toEqual([]);
  });

  it("reads the active rows when the rule is not there (app ahead of the migration, or rolled back)", async () => {
    const admin: any = table();
    admin.rpc = async () => ({ data: null, error: { message: "function does not exist" } });
    const out = await guardianLinksInForce(admin, ["kid", "grown"]);
    expect(out.error).toBeNull();
    expect(out.data!.map((l) => l.child_user_id).sort()).toEqual(["grown", "kid"]);
  });

  it("reads the active rows with a client that has no rpc, never the revoked ones", async () => {
    const out = await guardianLinksInForce(table() as any, ["kid"]);
    expect(out.data!.map((l) => l.parent_user_id)).toEqual(["mom"]);
  });

  it("passes a failed read on, so the caller can refuse to guess", async () => {
    const out = await guardianLinksInForce(table({ message: "down" }) as any, ["kid"]);
    expect(out.data).toBeNull();
    expect(out.error).toEqual({ message: "down" });
  });

  it("asks nothing for no children", async () => {
    const admin: any = table();
    admin.rpc = vi.fn();
    expect(await guardianLinksInForce(admin, [])).toEqual({ data: [], error: null });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.calls).toEqual([]);
  });
});
