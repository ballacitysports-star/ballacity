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

/** The body of applyOptimisticReview, from its arrow to the closing brace at its indent. */
function optimisticReviewBody(): string {
  const m = page.match(
    /const applyOptimisticReview = \(reqId: string, status: "approved" \| "rejected"\): \(\(\) => void\) => \{\n([\s\S]*?)\n {2}\};/,
  );
  expect(m).not.toBeNull();
  return m![1];
}

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

  it("lets saved settings claim a number so an older settings read cannot undo the save", () => {
    expect(page).toMatch(
      /onSettingsSaved=\{\(s\) => \{[^}]*?claimLocalWrite\(settingsReads\);\s*setSettings\(s\);\s*\}\}/,
    );
  });

  it("claims a number for the optimistic review before it writes the list", () => {
    const body = optimisticReviewBody();
    expect(body).toMatch(/^\s*claimLocalWrite\(hostReqReads\);[\s\S]*setHostRequests\(\(prev\) =>/);
    // Claimed in the body, not inside the updater, which React may defer or run twice.
    expect(body.indexOf("claimLocalWrite(hostReqReads)")).toBeLessThan(
      body.indexOf("setHostRequests("),
    );
  });

  it("undoes only the tapped row and leaves the tap's claim in force", () => {
    const body = optimisticReviewBody();
    expect(body).toMatch(
      /return \(\) => \{\s*setHostRequests\(\(prev\) => undoReview\(prev, before, reviewedAt\)\);/,
    );
    expect(body).not.toMatch(/setHostRequests\(snapshot\)/);
    // One claim, by the tap: the undo takes no number of its own.
    expect(body.match(/claimLocalWrite\(/g)).toHaveLength(1);
  });

  it("reads the list again after the undo, to recover what a read dropped by the tap carried", () => {
    const body = optimisticReviewBody();
    // After the row is restored, inside the undo, and as a normal numbered read, not a local write.
    expect(body).toMatch(
      /undoReview\(prev, before, reviewedAt\)\);\s*void refreshHostRequests\(\);\s*\};/,
    );
    expect(body.match(/refreshHostRequests\(/g)).toHaveLength(1);
  });

  it("orders the removal record on its own", () => {
    expect(page).toContain(
      "if (claimNewestRead(removedReads, removedReadNo)) setRemovedRecorded(removed);",
    );
  });
});
