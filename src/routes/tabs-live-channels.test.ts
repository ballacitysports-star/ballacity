import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Reels tab and the Profile tab must hold SUBSCRIBED until the server streams the changes, and
 * read again on every SUBSCRIBED, the first included: the load on mount may have been answered
 * before the changes were live. These read the route source, as messages-live-channels.test.ts
 * does: both pages are too large to render here.
 */
const reels = readFileSync("src/routes/_tabs.reels.tsx", "utf8");
const profile = readFileSync("src/routes/_tabs.profile.tsx", "utf8");

describe("Reels tab realtime channel", () => {
  it("opens the channel through liveChannel with its topic unchanged", () => {
    expect(reels).toContain("liveChannel(`my-reels-${user.id}`)");
    // highlight_reels is in the supabase_realtime publication.
    expect(reels).not.toMatch(/supabase\s*\.channel\(/);
  });

  it("loads the reels again on every SUBSCRIBED, the first included", () => {
    expect(reels).toContain(".subscribe(onLive(() => void load()));");
  });

  it("lets the newest load sent win", () => {
    expect(reels).toMatch(
      /const loadNo = \+\+loadsSent;[\s\S]*?if \(cancelled \|\| loadNo < newestLoadApplied\) return;\s*newestLoadApplied = loadNo;\s*setReels\(/,
    );
  });
});

describe("Profile tab realtime channels", () => {
  it("opens both channels through liveChannel with their topics unchanged", () => {
    expect(profile).toContain("liveChannel(`profile-join-requests-${profileUser.id}`)");
    expect(profile).toContain("liveChannel(`recaps-${profileUser.id}`)");
    // join_requests and highlight_reels are both in the supabase_realtime publication.
    expect(profile).not.toMatch(/supabase\s*\.channel\(/);
  });

  it("reads the join requests again, silently, on every SUBSCRIBED", () => {
    expect(profile).toContain(".subscribe(onLive(() => void refreshRequests({ silent: true })));");
  });

  it("lets the newest join request read sent win", () => {
    expect(profile).toMatch(
      /const readNo = \+\+requestReads\.current\.sent;[\s\S]*?if \(readNo < requestReads\.current\.newestApplied\) return;\s*requestReads\.current\.newestApplied = readNo;\s*setMyRequests\(mine\);\s*setHostRequests\(hosted\);/,
    );
  });

  it("loads the recaps again on every SUBSCRIBED, newest load winning", () => {
    const recaps = profile.slice(profile.indexOf("const load = () => {"));
    expect(recaps).toMatch(
      /const loadNo = \+\+loadsSent;[\s\S]*?\.select\(RECAP_COLUMNS\)[\s\S]*?if \(cancelled \|\| loadNo < newestLoadApplied\) return;\s*newestLoadApplied = loadNo;\s*const rows/,
    );
    expect(recaps).toMatch(
      /liveChannel\(`recaps-[\s\S]*?\.subscribe\(onLive\(\(\) => void load\(\)\)\);/,
    );
  });
});
