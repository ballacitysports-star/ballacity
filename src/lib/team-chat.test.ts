import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { listTeamChat, teamChatErrorMessage, type TeamChatClient } from "./team-chat";

type Result = { data: unknown; error: { message: string } | null };
function fake(tables: Record<string, Result>, calls: string[] = []): TeamChatClient {
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "limit"])
        q[m] = (...a: unknown[]) => (calls.push(`${t}.${m}(${JSON.stringify(a)})`), q);
      q.then = (ok: (r: Result) => unknown) =>
        Promise.resolve(tables[t] ?? { data: [], error: null }).then(ok);
      return q as never;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

describe("listTeamChat (P2-3)", () => {
  it("reads the team's newest messages and shows them oldest first, with names", async () => {
    const calls: string[] = [];
    const out = await listTeamChat(
      fake(
        {
          team_chat_messages: {
            data: [
              {
                id: "m2",
                sender_id: "u2",
                body: "later",
                moderation_status: "approved",
                hidden_at: null,
                created_at: "2026-11-09T10:01:00Z",
              },
              {
                id: "m1",
                sender_id: "u1",
                body: "first",
                moderation_status: "pending",
                hidden_at: "x",
                created_at: "2026-11-09T10:00:00Z",
              },
            ],
            error: null,
          },
          profiles: { data: [{ id: "u1", display_name: "Coach Sam" }], error: null },
        },
        calls,
      ),
      "hawks",
    );
    expect(out.map((m) => [m.id, m.senderName, m.status, m.hidden])).toEqual([
      ["m1", "Coach Sam", "pending", true],
      ["m2", "Member", "approved", false],
    ]);
    expect(calls).toContain('team_chat_messages.eq(["team_id","hawks"])');
    expect(calls).toContain('team_chat_messages.order(["created_at",{"ascending":false}])');
  });

  it("throws a readable error when the read fails", async () => {
    await expect(
      listTeamChat(
        fake({ team_chat_messages: { data: null, error: { message: "NOT_IN_TEAM_CHAT" } } }),
        "x",
      ),
    ).rejects.toThrow("You're not in this team's chat.");
  });

  it("puts every database refusal in plain words", () => {
    for (const code of [
      "NOT_IN_TEAM_CHAT",
      "RATE_LIMITED",
      "INVALID_MESSAGE",
      "NOT_TEAM_STAFF",
      "CANNOT_REPORT_SELF",
      "MESSAGE_NOT_FOUND",
    ]) {
      expect(teamChatErrorMessage(code)).not.toBe(code);
    }
  });
});

describe("sending (P2-3)", () => {
  it("screens first, sends as the member, then settles moderation", () => {
    const src = readFileSync("src/lib/team-chat.functions.ts", "utf8");
    const screen = src.indexOf("screenPostText(");
    const block = src.indexOf('if (screen === "block")');
    const send = src.search(/context\.supabase\.rpc\(\s*"send_team_chat_message"/);
    const settle = src.search(/settlePostModeration\(\s*supabaseAdmin,\s*"team_chat_messages"/);
    expect(screen).toBeGreaterThan(0);
    expect(block).toBeGreaterThan(screen);
    expect(send).toBeGreaterThan(block);
    expect(settle).toBeGreaterThan(send);
  });

  it("the team page shows the Chat tab only to people in the chat, behind the switch", () => {
    const page = readFileSync("src/routes/teams.$teamId.index.tsx", "utf8");
    expect(page).toMatch(/const chatAccess = useTeamChatAccess\(org\.id, !!user\);/);
    expect(page).toMatch(/search\.tab === "chat" && chatAccess/);
    expect(page).toMatch(/tab === "chat" && chatAccess && user &&/);
    const lib = readFileSync("src/lib/team-chat.ts", "utf8");
    expect(lib).toMatch(/if \(!on\) return false;/);
    expect(lib).toMatch(/"can_use_team_chat"/);
  });
});
