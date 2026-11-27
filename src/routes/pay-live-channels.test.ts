import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The pay page's two realtime channels (the viewer's join request and their payments) must hold SUBSCRIBED until the
 * server streams the changes, and read again on every SUBSCRIBED: the lookup on load may have been answered before
 * the changes were live. These read the route source, as pay-terms-wiring.test.ts does: the page is too large to
 * render here. The e2e specs pay-approval-realtime-only.spec.ts and pay-realtime-delayed-polling-no-duplicates.spec.ts
 * find the request channel by its "pay-join-req:" topic, so the topics must stay as they are.
 */
const pay = readFileSync("src/routes/games.$gameId.pay.tsx", "utf8");

describe("pay page realtime channels", () => {
  it("opens both channels through liveChannel with their topics unchanged", () => {
    expect(pay).toContain("liveChannel(`pay-join-req:${gameId}:${userId}`)");
    expect(pay).toContain("liveChannel(`pay-subs:${gameId}:${userId}`)");
    // Both tables are in the supabase_realtime publication; no channel here is opened without wait.
    expect(pay).not.toMatch(/supabase\s*\.channel\(/);
  });

  it("reads the request and the payments again on every SUBSCRIBED", () => {
    expect(pay).toContain(".subscribe(onLive(() => void refreshRef.current()))");
    expect(pay).toContain(".subscribe(onLive(() => void refreshSubsRef.current()))");
  });

  it("lets the newest read sent win, in the lookup on load and in both refreshes", () => {
    expect(pay).toContain("claimNewestRead(reqReadOrder.current, readNo)");
    expect(pay).toContain("claimNewestRead(subsReadOrder.current, readNo)");
    expect(pay).toContain("claimNewestRead(reqReadOrder.current, reqReadNo)");
    expect(pay).toContain("claimNewestRead(subsReadOrder.current, subsReadNo)");
  });

  it("toasts approval only after the page has read the request once", () => {
    // Otherwise a catch-up that answers before the lookup on load tells an approved player "You're approved!" again.
    expect(pay).toMatch(
      /if \(answeredBefore && req\?\.status === "approved" && prev\?\.status !== "approved"\) \{\s*toast\.success\("You're approved! You can pay now\."\);/,
    );
  });
});
