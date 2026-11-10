import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Resolving a game's host must never depend on game_payment_settings alone.
 *
 * The SELECT policy on game_payment_settings admits only the host and players
 * already linked to the game — an approved join_request, a payment_submission,
 * or a game_participants row. A prospective player browsing a game they have
 * not joined matches none of those, so PostgREST returns zero rows and
 * getGamePaymentSettings() resolves to null. No error is raised: RLS filters
 * rows, it does not fail the request, and refreshStatus() swallows throws
 * anyway. `settings` therefore stays null indefinitely for that viewer.
 *
 * hosted_games.host_id carries the same value and *is* readable by them
 * (verified against production: the game row came back, the settings row did
 * not). Every host_id read in the route already falls back to it — except the
 * message-host button, which reported "This host can't be messaged yet" to
 * exactly the population the button exists for. Contacting a host before
 * joining is the normal path, so the failure was total for that path, not an
 * edge case.
 *
 * This is pinned rather than left to review because the bare form reads as
 * correct, the fallback looks redundant, and the bug is invisible to anyone
 * testing as the host — whose own settings row is always visible.
 */

const ROUTE = new URL("../routes/games.$gameId.index.tsx", import.meta.url);
const src = readFileSync(ROUTE, "utf8");
// The game page's pieces moved into src/components/game-detail (P2-6 slice 2); they are held to the
// same rule, so a read moved out of the route is still checked.
const PARTS_DIR = new URL("../components/game-detail/", import.meta.url);
const parts = readdirSync(PARTS_DIR)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
  .map((f) => readFileSync(new URL(f, PARTS_DIR), "utf8"));

describe("host id resolution in the game detail route", () => {
  it("never reads settings.host_id without a fallback", () => {
    // Matches `settings?.host_id` that is NOT followed by `??`, ignoring the
    // dependency arrays where a bare read is just a change signal.
    const bare = [src, ...parts]
      .join("\n")
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /settings\?\.host_id/.test(line))
      .filter(([, line]) => !/settings\?\.host_id\s*\?\?/.test(line))
      .filter(([, line]) => !/^\s*\}, \[/.test(line))
      .filter(([, line]) => !/\?\?\s*settings\?\.host_id/.test(line));

    expect(
      bare.map(([n, line]) => `${n}: ${line.trim()}`),
      "settings.host_id is null for any viewer who has not joined the game; " +
        "fall back to game.hostUserId",
    ).toEqual([]);
  });

  it("resolves the message-host target from the game row too", () => {
    const at = src.indexOf("This host can't be messaged yet");
    expect(at, "the message-host guard should still exist").toBeGreaterThan(-1);
    // The resolution sits immediately above the guard it feeds.
    const preceding = src.slice(0, at).split("\n").slice(-6).join("\n");
    expect(preceding).toMatch(/const hostUid =[\s\S]*game\.hostUserId/);
  });
});
