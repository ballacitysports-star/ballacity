// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * useMyAge reads the viewer's birthday through get_my_birthday. A failed read used to look exactly like "no birthday
 * on file" (age null), which the pay page's age range would turn into "Add your birthday to your profile". It now
 * reports `error` (age stays null, so the game page's reading is unchanged) and can `retry`.
 */

const rpc = vi.hoisted(() => ({
  answers: [] as Array<{ data: unknown; error: unknown } | "throw">,
  calls: 0,
}));

vi.mock("@/lib/current-user-id", () => ({ getCurrentUserId: async () => "viewer" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => {
      expect(name).toBe("get_my_birthday");
      rpc.calls += 1;
      const next = rpc.answers.shift() ?? { data: null, error: null };
      if (next === "throw") throw new Error("offline");
      return next;
    },
  },
}));

import { useMyAge } from "./use-my-age";

/** A birthday `years` years ago today, so the derived age is exactly `years`. */
function birthdayYearsAgo(years: number): string {
  const d = new Date();
  return `${d.getFullYear() - years}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

afterEach(() => {
  rpc.answers = [];
  rpc.calls = 0;
});

describe("useMyAge", () => {
  it("answers the age from the birthday on file", async () => {
    rpc.answers.push({ data: birthdayYearsAgo(30), error: null });
    const { result } = renderHook(() => useMyAge());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ age: 30, error: false });
  });

  it("answers null, without an error, when no birthday is on file", async () => {
    rpc.answers.push({ data: null, error: null });
    const { result } = renderHook(() => useMyAge());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ age: null, error: false });
  });

  it("reports an error when the RPC answers one, and when it throws", async () => {
    rpc.answers.push({ data: null, error: { message: "boom" } });
    const first = renderHook(() => useMyAge());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current).toMatchObject({ age: null, error: true });

    rpc.answers.push("throw");
    const second = renderHook(() => useMyAge());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current).toMatchObject({ age: null, error: true });
  });

  it("asks again on retry and clears the error once it answers", async () => {
    rpc.answers.push({ data: null, error: { message: "boom" } });
    rpc.answers.push({ data: birthdayYearsAgo(16), error: null });
    const { result } = renderHook(() => useMyAge());
    await waitFor(() => expect(result.current.error).toBe(true));
    act(() => result.current.retry());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ age: 16, error: false });
    expect(rpc.calls).toBe(2);
  });
});
