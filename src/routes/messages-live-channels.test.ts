import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Inbox list and a conversation thread must hold SUBSCRIBED until the server streams the changes, and read again
 * on every SUBSCRIBED, the first included: the load on mount may have been answered before the changes were live.
 * These read the route source, as pay-live-channels.test.ts does: both pages are too large to render here.
 */
const inbox = readFileSync("src/routes/messages.index.tsx", "utf8");
const thread = readFileSync("src/routes/messages.$conversationId.tsx", "utf8");

describe("Inbox list realtime channel", () => {
  it("opens the channel through liveChannel with its topic unchanged", () => {
    expect(inbox).toContain("liveChannel(`inbox-${user.id}`)");
    // messages and conversations are both in the supabase_realtime publication.
    expect(inbox).not.toMatch(/supabase\s*\.channel\(/);
  });

  it("reloads on every SUBSCRIBED, the first included", () => {
    expect(inbox).toMatch(/\.subscribe\(\s*onLive\(\(\) => \{\s*if \(!cancelled\) void load\(\);/);
    expect(inbox).not.toContain("hasSubscribed");
  });

  it("lets the newest load sent win, for a success and for a failure", () => {
    expect(inbox).toMatch(
      /if \(!cancelled && loadNo > newestLoadApplied\) \{\s*newestLoadApplied = loadNo;\s*setConvs\(data\);/,
    );
    expect(inbox).toContain("if (!cancelled && loadNo > newestLoadApplied) setLoadFailed(true);");
  });
});

describe("conversation thread realtime channel", () => {
  it("opens the channel through liveChannel with its topic and presence key unchanged", () => {
    expect(thread).toMatch(
      /liveChannel\(`thread-\$\{conversationId\}`, \{\s*config: \{ presence: \{ key: user\.id \} \},\s*\}\)/,
    );
    // messages and message_reactions are both in the supabase_realtime publication.
    expect(thread).not.toMatch(/supabase\s*\.channel\(/);
  });

  it("catches up on every SUBSCRIBED, the first included, before tracking presence", () => {
    expect(thread).toMatch(
      /onLive\(\(\) => \{\s*if \(cancelled\) return;[^}]*void catchUp\(\);\s*void channel\.track\(/,
    );
    expect(thread).not.toContain("hasSubscribed");
  });

  it("merges caught-up messages by id, so none shows twice, and re-reads reactions newest-wins", () => {
    expect(thread).toMatch(
      /const catchUp = async \(\) => \{[\s\S]*?setMsgs\(\(prev\) => upsertMessages\(prev, m\)\);[\s\S]*?await loadReactions\(/,
    );
    expect(thread).toContain("if (cancelled || readNo < newestReactionReadApplied) return;");
  });
});
