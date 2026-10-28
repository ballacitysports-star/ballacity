// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAutosave } from "./use-autosave";

afterEach(cleanup);

type V = { name: string };

function setup(opts: {
  save?: (v: V) => Promise<void> | void;
  validate?: (v: V) => string | null;
}) {
  return renderHook(
    ({ value }: { value: V }) =>
      useAutosave<V>({
        value,
        save: opts.save ?? (() => {}),
        validate: opts.validate,
        delay: 10_000,
      }),
    { initialProps: { value: { name: "Sam" } } },
  );
}

describe("useAutosave flush result", () => {
  it("is true when nothing changed", async () => {
    const { result } = setup({});
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
  });

  it("is true after a successful save", async () => {
    const save = vi.fn(async () => {});
    const { result, rerender } = setup({ save });
    rerender({ value: { name: "Sammy" } });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("is false when the value is refused as invalid, and nothing is saved", async () => {
    const save = vi.fn(async () => {});
    const { result, rerender } = setup({
      save,
      validate: (v) => (v.name.trim() ? null : "name is required"),
    });
    rerender({ value: { name: "" } });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(save).not.toHaveBeenCalled();
    expect(ok).toBe(false);
    expect(result.current.status).toBe("invalid");
  });

  it("is false when the save fails", async () => {
    const { result, rerender } = setup({
      save: async () => {
        throw new Error("nope");
      },
    });
    rerender({ value: { name: "Sammy" } });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(false);
    expect(result.current.status).toBe("error");
  });
});
