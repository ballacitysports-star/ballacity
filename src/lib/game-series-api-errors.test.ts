import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * startGameSeries / stopGameSeries hand back the PostgREST error itself, so its SQLSTATE and the SERIES_* HINT reach
 * userErrorMessage (a signed-out host reads the sign-in sentence, a non-host the host-only one).
 */
const rpc = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => rpc.result) },
}));

const { startGameSeries, stopGameSeries } = await import("./game-series-api");
const { userErrorMessage } = await import("./user-error");

beforeEach(() => {
  rpc.result = { data: null, error: null };
});

describe("game series RPC errors", () => {
  it("startGameSeries rethrows the PostgREST error with its code and hint", async () => {
    const pgError = {
      message: "Only the host can make this game repeat.",
      code: "42501",
      details: null,
      hint: "SERIES_NOT_HOST",
    };
    rpc.result = { data: null, error: pgError };
    const err = await startGameSeries("g1", { freq: "weekly", until: null }).catch((e) => e);
    expect(err).toBe(pgError);
    expect(err).toMatchObject({ code: "42501", hint: "SERIES_NOT_HOST" });
  });

  it("a signed-out start reads as sign in, not as a missing permission", async () => {
    rpc.result = {
      data: null,
      error: {
        message: "Sign in to make a game repeat.",
        code: "42501",
        details: null,
        hint: null,
      },
    };
    const err = await startGameSeries("g1", { freq: "weekly", until: null }).catch((e) => e);
    expect(userErrorMessage(err, "fallback")).toBe("Sign in to make a game repeat.");
  });

  it("stopGameSeries rethrows the PostgREST error, and a signed-out stop reads as sign in", async () => {
    const pgError = { message: "Sign in first.", code: "42501", details: null, hint: null };
    rpc.result = { data: null, error: pgError };
    const err = await stopGameSeries("s1").catch((e) => e);
    expect(err).toBe(pgError);
    expect(userErrorMessage(err, "fallback")).toBe("Sign in to continue.");
  });

  it("returns the server's answer when there is no error", async () => {
    rpc.result = { data: { series_id: "s9", created: 3 }, error: null };
    await expect(startGameSeries("g1", { freq: "biweekly", until: null })).resolves.toEqual({
      seriesId: "s9",
      created: 3,
    });
    rpc.result = { data: true, error: null };
    await expect(stopGameSeries("s9")).resolves.toBe(true);
  });
});
