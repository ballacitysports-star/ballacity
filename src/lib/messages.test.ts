import { describe, expect, it } from "vitest";
import {
  buildConversationList,
  previewOf,
  countInboxMessages,
  upsertMessages,
  type ConversationListInput,
  type Message,
} from "./messages";

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

  it("gives an attachment-only message a neutral preview, not 'say hi'", () => {
    const [row] = buildConversationList(input({ lastByConv: { c1: { body: null } } }));
    expect(row!.last_message).toBe("Sent a message");
  });
});

describe("upsertMessages", () => {
  const msg = (id: string, at: string, over: Partial<Message> = {}): Message => ({
    id,
    conversation_id: "c1",
    sender_id: THEM,
    body: id,
    read_at: null,
    created_at: at,
    ...over,
  });
  const A = msg("a", "2026-10-20T10:00:00.000000+00:00");
  const B = msg("b", "2026-10-20T10:01:00.000000+00:00");
  const C = msg("c", "2026-10-20T10:02:00.000000+00:00");

  it("never shows a message twice", () => {
    expect(upsertMessages([A, B], [B])).toEqual([A, B]);
    expect(upsertMessages([A, B], [A, B, C])).toEqual([A, B, C]);
  });

  it("keeps a message that arrived while a fetch was in flight", () => {
    // The event for C landed first; the fetch that started earlier lacks it.
    expect(upsertMessages([C], [A, B])).toEqual([A, B, C]);
  });

  it("puts messages in send order whichever way they arrive", () => {
    expect(upsertMessages([C, A], [B]).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("takes the fetched copy when both have the message", () => {
    const read = { ...B, read_at: "2026-10-20T10:05:00.000000+00:00" };
    expect(upsertMessages([B], [read])[0]!.read_at).toBe(read.read_at);
  });

  it("returns the same list when there is nothing to add", () => {
    const current = [A, B];
    expect(upsertMessages(current, [])).toBe(current);
  });

  it("starts a list from nothing", () => {
    expect(upsertMessages([], [B, A]).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("previewOf", () => {
  it("shows the text of the latest message", () => {
    expect(previewOf({ body: "See you at 6" })).toBe("See you at 6");
  });

  it("does not invite a 'say hi' on a thread that has history but no text", () => {
    expect(previewOf({ body: "" })).toBe("Sent a message");
    expect(previewOf({ body: null })).toBe("Sent a message");
    expect(previewOf({ body: "   " })).toBe("Sent a message");
  });

  it("is null only when the thread has no messages at all", () => {
    expect(previewOf(undefined)).toBeNull();
  });
});

describe("countInboxMessages", () => {
  const me = "me";
  const row = (
    id: string,
    over: Partial<{
      unread: number;
      last_created_at: string | null;
      last_sender_id: string | null;
    }> = {},
  ) => ({
    conversation_id: id,
    unread: 0,
    last_created_at: "2026-10-28T10:00:00Z",
    last_sender_id: "them",
    ...over,
  });

  it("counts unread messages only in threads the member has accepted", () => {
    const out = countInboxMessages({
      me,
      summaries: [row("a", { unread: 2 }), row("b", { unread: 1 })],
      acceptedBy: { a: [me, "them"], b: ["them"] },
    });
    expect(out.unread).toBe(2);
  });

  it("counts a request once the other person has actually written", () => {
    const out = countInboxMessages({
      me,
      summaries: [row("r", { unread: 3 })],
      acceptedBy: { r: ["them"] },
    });
    expect(out).toEqual({ unread: 0, requests: 1 });
  });

  it("ignores a thread nobody has written in", () => {
    const out = countInboxMessages({
      me,
      summaries: [row("empty", { last_created_at: null, last_sender_id: null })],
      acceptedBy: { empty: [] },
    });
    expect(out).toEqual({ unread: 0, requests: 0 });
  });

  it("does not call a thread whose last message is the member's own a request", () => {
    const out = countInboxMessages({
      me,
      summaries: [row("mine", { last_sender_id: me })],
      acceptedBy: { mine: [] },
    });
    expect(out.requests).toBe(0);
  });

  it("treats a missing accepted_by as not accepted and never goes negative", () => {
    const out = countInboxMessages({
      me,
      summaries: [row("x", { unread: -4 }), row("y", { unread: 2 })],
      acceptedBy: { y: [me] },
    });
    expect(out.unread).toBe(2);
    expect(out.requests).toBe(1);
  });
});
