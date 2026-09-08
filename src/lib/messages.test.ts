import { describe, expect, it } from "vitest";
import { buildConversationList, type ConversationListInput } from "./messages";

const ME = "me-user-id";
const THEM = "them-user-id";

function input(over: Partial<ConversationListInput> = {}): ConversationListInput {
  return {
    me: ME,
    convs: [{ id: "c1", accepted_by: [] }],
    participants: [
      { conversation_id: "c1", user_id: ME },
      { conversation_id: "c1", user_id: THEM },
    ],
    profilesById: {
      [THEM]: { display_name: "Jordan Reed", avatar_initials: "JR", avatar_url: "u.png" },
    },
    lastByConv: {},
    unreadByConv: {},
    ...over,
  };
}

describe("buildConversationList — the counterpart", () => {
  it("resolves the other participant and their profile", () => {
    const [row] = buildConversationList(input());
    expect(row!.other_user_id).toBe(THEM);
    expect(row!.other_display_name).toBe("Jordan Reed");
    expect(row!.other_initials).toBe("JR");
    expect(row!.other_avatar_url).toBe("u.png");
  });

  it("never picks the signed-in member as their own counterpart", () => {
    const [row] = buildConversationList(
      input({ participants: [{ conversation_id: "c1", user_id: ME }] }),
    );
    expect(row!.other_user_id).toBeNull();
  });

  it("survives an orphaned thread with no counterpart", () => {
    // Production has one of these: a conversation with a single participant.
    // It should degrade to a placeholder rather than throw.
    const [row] = buildConversationList(
      input({ participants: [{ conversation_id: "c1", user_id: ME }], profilesById: {} }),
    );
    expect(row!.other_display_name).toBe("Player");
    expect(row!.other_initials).toBe("PL");
    expect(row!.other_avatar_url).toBeNull();
  });

  it("falls back to initials derived from the name when none are stored", () => {
    const [row] = buildConversationList(
      input({ profilesById: { [THEM]: { display_name: "sam", avatar_initials: null } } }),
    );
    expect(row!.other_initials).toBe("SA");
  });

  it("keeps each thread's counterpart separate", () => {
    const rows = buildConversationList(
      input({
        convs: [
          { id: "c1", accepted_by: [] },
          { id: "c2", accepted_by: [] },
        ],
        participants: [
          { conversation_id: "c1", user_id: ME },
          { conversation_id: "c1", user_id: THEM },
          { conversation_id: "c2", user_id: ME },
          { conversation_id: "c2", user_id: "third-user" },
        ],
      }),
    );
    expect(rows.map((r) => r.other_user_id)).toEqual([THEM, "third-user"]);
  });
});

describe("buildConversationList — request state", () => {
  it("treats a thread as a request until the member has accepted", () => {
    const [row] = buildConversationList(input({ convs: [{ id: "c1", accepted_by: [THEM] }] }));
    expect(row!.is_request).toBe(true);
  });

  it("stops being a request once the member is in accepted_by", () => {
    const [row] = buildConversationList(input({ convs: [{ id: "c1", accepted_by: [ME] }] }));
    expect(row!.is_request).toBe(false);
  });

  it("treats a thread nobody has written in as a request for everyone", () => {
    // 12 of 17 production conversations are in this state — created by tapping
    // "message" and never written in. Documented rather than endorsed.
    const [row] = buildConversationList(input({ convs: [{ id: "c1", accepted_by: [] }] }));
    expect(row!.is_request).toBe(true);
  });

  it("tolerates accepted_by being absent entirely", () => {
    const [row] = buildConversationList(input({ convs: [{ id: "c1" }] }));
    expect(row!.accepted_by).toEqual([]);
    expect(row!.is_request).toBe(true);
  });
});

describe("buildConversationList — preview and unread", () => {
  it("shows the latest body and unread count for the thread", () => {
    const [row] = buildConversationList(
      input({ lastByConv: { c1: { body: "see you there" } }, unreadByConv: { c1: 3 } }),
    );
    expect(row!.last_message).toBe("see you there");
    expect(row!.unread).toBe(3);
  });

  it("reports no preview and zero unread for an empty thread", () => {
    const [row] = buildConversationList(input());
    expect(row!.last_message).toBeNull();
    expect(row!.unread).toBe(0);
  });

  it("does not leak one thread's preview onto another", () => {
    const rows = buildConversationList(
      input({
        convs: [
          { id: "c1", accepted_by: [ME] },
          { id: "c2", accepted_by: [ME] },
        ],
        participants: [
          { conversation_id: "c1", user_id: ME },
          { conversation_id: "c1", user_id: THEM },
          { conversation_id: "c2", user_id: ME },
          { conversation_id: "c2", user_id: THEM },
        ],
        lastByConv: { c1: { body: "only in c1" } },
        unreadByConv: { c1: 2 },
      }),
    );
    expect(rows[0]!.last_message).toBe("only in c1");
    expect(rows[1]!.last_message).toBeNull();
    expect(rows[1]!.unread).toBe(0);
  });

  it("treats an attachment-only message as having no text preview", () => {
    const [row] = buildConversationList(input({ lastByConv: { c1: { body: null } } }));
    expect(row!.last_message).toBeNull();
  });
});
