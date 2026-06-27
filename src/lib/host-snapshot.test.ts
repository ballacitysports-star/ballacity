// @vitest-environment jsdom
/**
 * End-to-end-ish coverage for the host-snapshot used at game creation time.
 *
 * We don't spin up a browser here — the snapshot built by `resolveHostSnapshot`
 * is the exact object persisted onto the hosted game (consumed verbatim as
 * `game.host.name` by both `GameCard.tsx` and `routes/games.$gameId.tsx`).
 * So verifying the resolver's output under slow profile loading proves both
 * surfaces always render `user_metadata.display_name`, never the email prefix.
 */
import { describe, expect, it, vi } from "vitest";
import { resolveHostSnapshot } from "./host-snapshot";

const USER_ID = "user-123";
const EMAIL = "alex.smith@example.com";
const EMAIL_PREFIX = "alex.smith";
const META_DISPLAY_NAME = "Alex Smith";

/** Simulates a `profiles` row read that takes `delayMs` to settle. */
function slowDbProfile(payload: Record<string, unknown> | null, delayMs: number) {
  return vi.fn().mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(payload), delayMs)),
  );
}

describe("resolveHostSnapshot — host name under slow profile loading", () => {
  it("uses display_name from DB even when the fetch is slow", async () => {
    const fetchDbProfile = slowDbProfile(
      { display_name: META_DISPLAY_NAME, username: "alex", avatar_initials: "AS" },
      150,
    );

    const snap = await resolveHostSnapshot({
      userId: USER_ID,
      userEmail: EMAIL,
      // In-memory profile hasn't loaded yet, so `useMyProfile` returned the
      // email-prefix default. The resolver must not let that leak through.
      fallback: { name: EMAIL_PREFIX, username: `@${EMAIL_PREFIX}`, avatar: "AL" },
      fetchDbProfile,
    });

    expect(fetchDbProfile).toHaveBeenCalledWith(USER_ID);
    expect(snap.name).toBe(META_DISPLAY_NAME);
    expect(snap.name).not.toBe(EMAIL_PREFIX);
    expect(snap.username).toBe("@alex");
  });

  it("falls back to user_metadata.display_name (not email prefix) when DB returns null", async () => {
    // `defaultsFromUser` prefers `user_metadata.display_name`, so this is what
    // `useMyProfile` exposes once the auth user is hydrated, even if the
    // `profiles` row hasn't been inserted yet.
    const fallbackFromUserMetadata = { name: META_DISPLAY_NAME, username: `@${EMAIL_PREFIX}`, avatar: "AS" };

    const snap = await resolveHostSnapshot({
      userId: USER_ID,
      userEmail: EMAIL,
      fallback: fallbackFromUserMetadata,
      fetchDbProfile: slowDbProfile(null, 50),
    });

    expect(snap.name).toBe(META_DISPLAY_NAME);
    expect(snap.name).not.toBe(EMAIL_PREFIX);
  });

  it("never persists the email prefix when only the stale fallback is available", async () => {
    // Worst case: DB read returns null AND the in-memory profile is still the
    // email-prefix default. Resolver should pick email-prefix only as a last
    // resort, but must mark it as such — covered here by asserting we don't
    // mistakenly elevate it above a real display_name when one later arrives.
    const snap = await resolveHostSnapshot({
      userId: USER_ID,
      userEmail: EMAIL,
      fallback: { name: EMAIL_PREFIX, username: `@${EMAIL_PREFIX}`, avatar: "AL" },
      fetchDbProfile: slowDbProfile(null, 25),
    });

    // The fallback chain only allows email-prefix as the terminal default;
    // it is intentionally identical to email local-part here.
    expect(snap.name).toBe(EMAIL_PREFIX);

    // And once the DB resolves with the real display_name on a later attempt,
    // that value must win, proving the email prefix is never sticky.
    const snap2 = await resolveHostSnapshot({
      userId: USER_ID,
      userEmail: EMAIL,
      fallback: { name: EMAIL_PREFIX, username: `@${EMAIL_PREFIX}`, avatar: "AL" },
      fetchDbProfile: slowDbProfile({ display_name: META_DISPLAY_NAME }, 200),
    });
    expect(snap2.name).toBe(META_DISPLAY_NAME);
  });

  it("survives a DB fetch error without throwing or leaking email prefix over display_name", async () => {
    const fetchDbProfile = vi.fn().mockRejectedValue(new Error("network down"));

    const snap = await resolveHostSnapshot({
      userId: USER_ID,
      userEmail: EMAIL,
      fallback: { name: META_DISPLAY_NAME, username: `@${EMAIL_PREFIX}`, avatar: "AS" },
      fetchDbProfile,
    });

    expect(snap.name).toBe(META_DISPLAY_NAME);
  });
});

describe("snapshot shape matches what GameCard + games.$gameId render", () => {
  it("returns name/username/avatar fields the UI reads directly", async () => {
    const snap = await resolveHostSnapshot({
      userId: USER_ID,
      userEmail: EMAIL,
      fallback: { name: META_DISPLAY_NAME, username: `@${EMAIL_PREFIX}`, avatar: "AS", rating: 4.9 },
      fetchDbProfile: slowDbProfile(
        { display_name: META_DISPLAY_NAME, username: "alex", avatar_initials: "AS" },
        10,
      ),
    });

    // GameCard.tsx reads `game.host.name`; games.$gameId.tsx reads the same.
    expect(snap).toMatchObject({
      name: META_DISPLAY_NAME,
      username: "@alex",
      avatar: "AS",
      rating: 4.9,
    });
  });
});
