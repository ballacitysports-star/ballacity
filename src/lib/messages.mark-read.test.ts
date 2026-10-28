import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; filters: [string, ...unknown[]][] }[],
  messagesError: null as null | { message: string },
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const rec = { table, op: "", filters: [] as [string, ...unknown[]][] };
    h.calls.push(rec);
    const result = () => ({ error: table === "messages" ? h.messagesError : null });
    const q: any = {
      update: (v: unknown) => {
        rec.op = `update ${JSON.stringify(Object.keys(v as object))}`;
        return q;
      },
      eq: (...a: unknown[]) => (rec.filters.push(["eq", ...a]), q),
      neq: (...a: unknown[]) => (rec.filters.push(["neq", ...a]), q),
      like: (...a: unknown[]) => (rec.filters.push(["like", ...a]), q),
      is: (...a: unknown[]) => (rec.filters.push(["is", ...a]), q),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return q;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
      from: (t: string) => chain(t),
    },
  };
});
vi.mock("@/lib/message-attachments.functions", () => ({ finalizeMessageAttachment: vi.fn() }));
vi.mock("@/lib/message-attachment-validation", () => ({ ATTACHMENT_ACCEPT: "" }));

import { markConversationRead } from "./messages";

beforeEach(() => {
  h.calls.length = 0;
  h.messagesError = null;
});

describe("markConversationRead", () => {
  it("also clears this thread's 'new message' notifications, and only those", async () => {
    expect(await markConversationRead("c1")).toBe(true);
    const n = h.calls.find((c) => c.table === "notifications")!;
    expect(n).toBeTruthy();
    expect(n.filters).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", "me"],
        ["eq", "type", "message"],
        ["like", "link", "/messages/c1%"],
        ["is", "read_at", null],
      ]),
    );
  });

  it("leaves the notifications alone when the messages could not be marked read", async () => {
    h.messagesError = { message: "nope" };
    expect(await markConversationRead("c1")).toBe(false);
    expect(h.calls.some((c) => c.table === "notifications")).toBe(false);
  });
});
