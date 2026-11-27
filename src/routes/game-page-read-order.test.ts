import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The game page reads the host's request list, the settings and the removal record on mount, on
 * changes and on every SUBSCRIBED of its live channels (src/lib/game-realtime.ts), so the reads
 * overlap and can answer in either order. Each replaces its state wholesale, so only the newest
 * read sent may land (src/lib/read-order.ts). These read the route source, as
 * pay-live-channels.test.ts does: the page is too large to render here.
 */
const page = readFileSync("src/routes/games.$gameId.index.tsx", "utf8");

describe("game page read order", () => {
  it("lets only the newest host request read replace the list", () => {
    expect(page).toMatch(
      /const readNo = \+\+hostReqReads\.sent;\s*try \{\s*const all = await listHostJoinRequests\(\);\s*if \(!claimNewestRead\(hostReqReads, readNo\)\) return;\s*setHostRequests\(/,
    );
  });

  it("orders the early and the final settings by the same read number", () => {
    expect(page).toMatch(
      /if \(!leavingRef\.current && claimNewestRead\(settingsReads, settingsReadNo\)\) \{\s*setSettings\(early\);/,
    );
    expect(page).toContain("if (claimNewestRead(settingsReads, settingsReadNo)) setSettings(s);");
  });

  it("orders the removal record on its own", () => {
    expect(page).toContain(
      "if (claimNewestRead(removedReads, removedReadNo)) setRemovedRecorded(removed);",
    );
  });
});
