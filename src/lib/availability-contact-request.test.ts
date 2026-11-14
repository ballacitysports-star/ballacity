import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A contact request or game invitation the database refuses for safety reasons (migration 20261114100000) must
 * reach the sender as the one neutral line, never as the raw MINOR_MESSAGING_BLOCKED code, while every other
 * error (a duplicate pending request, for one) still reaches the caller unchanged.
 */

const server = {
  insertError: null as { code?: string; message: string } | null,
  inserted: [] as unknown[],
};
const notify = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "sender" } } }) },
    from: () => ({
      insert: async (row: unknown) => {
        server.inserted.push(row);
        return { error: server.insertError };
      },
    }),
  },
}));
vi.mock("@/lib/notifications", () => ({ createNotification: notify }));

const { createContactRequest } = await import("./availability");

beforeEach(() => {
  server.insertError = null;
  server.inserted = [];
  notify.mockReset();
});

describe("createContactRequest", () => {
  it("sends the request", async () => {
    await createContactRequest("post-1", "author", " hi ");
    expect(server.inserted).toEqual([
      expect.objectContaining({
        availability_id: "post-1",
        from_user_id: "sender",
        to_user_id: "author",
        message: "hi",
        kind: "contact",
      }),
    ]);
  });

  it("shows a refusal about the recipient as the neutral line", async () => {
    server.insertError = {
      code: "42501",
      message: "MINOR_MESSAGING_BLOCKED:recipient_restricted:other",
    };
    const err = await createContactRequest("post-1", "author", "hi").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("This player can't receive messages from you right now.");
    expect((err as Error).message).not.toContain("MINOR_MESSAGING_BLOCKED");
  });

  it("explains a refusal about the sender's own account without the raw code", async () => {
    server.insertError = {
      code: "42501",
      message: "MINOR_MESSAGING_BLOCKED:teen_needs_shared_game:self",
    };
    const err = await createContactRequest("post-1", "author", "hi").catch((e: Error) => e);
    expect((err as Error).message).not.toContain("MINOR_MESSAGING_BLOCKED");
  });

  it("does not notify anyone when an invitation is refused", async () => {
    server.insertError = {
      code: "42501",
      message: "MINOR_MESSAGING_BLOCKED:recipient_restricted:other",
    };
    await createContactRequest("post-1", "author", "hi", { gameId: "g1", title: "Run" }).catch(
      () => undefined,
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("passes any other error through unchanged (the dialog recognises duplicates by code)", async () => {
    server.insertError = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    };
    const err = await createContactRequest("post-1", "author", "hi").catch((e: unknown) => e);
    expect(err).toBe(server.insertError);
  });
});
