import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The send path: who is signed in, what is read after the insert, and who is
 * notified. The database is faked so the order and overlap of the calls can be
 * observed, which is what changed when sending was made faster.
 */

const ME = "me-id";
const THEM = "them-id";

const h = vi.hoisted(() => {
  const state = {
    session: { user: { id: "me-id" } } as { user: { id: string } } | null,
    insertError: null as unknown,
    acceptedBy: [] as string[],
    participants: ["me-id", "them-id"],
    displayName: "Sam" as string | null,
    myMessageCount: 1,
    removeError: null as unknown,
    signedUrlDelay: null as Promise<void> | null,
    log: [] as string[],
    inserted: [] as Record<string, unknown>[],
    readsInFlight: 0,
    maxReadsInFlight: 0,
  };
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  /** A thenable query builder that resolves to `result()` after a tick. */
  const read = (label: string, result: () => unknown, overlap = false) => {
    const run = async () => {
      state.log.push(label);
      if (overlap) {
        state.readsInFlight++;
        state.maxReadsInFlight = Math.max(state.maxReadsInFlight, state.readsInFlight);
      }
      await tick();
      if (overlap) state.readsInFlight--;
      return result();
    };
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = run;
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej);
    return b;
  };

  const getUser = vi.fn(() => {
    throw new Error("auth.getUser() asks the auth server and must not be on this path");
  });
  const gate: { current: Promise<void> } = { current: Promise.resolve() };
  const createNotification = vi.fn(() => gate.current);

  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session } })),
      getUser,
    },
    from: (table: string) => {
      if (table === "messages") {
        return {
          insert: (row: Record<string, unknown>) => {
            state.log.push("insert");
            state.inserted.push(row);
            return Promise.resolve({ error: state.insertError });
          },
          select: () => read("count", () => ({ count: state.myMessageCount })),
        };
      }
      if (table === "conversations") {
        return read(
          "read:conversations",
          () => ({ data: { accepted_by: state.acceptedBy } }),
          true,
        );
      }
      if (table === "conversation_participants") {
        return read(
          "read:participants",
          () => ({ data: state.participants.map((user_id) => ({ user_id })) }),
          true,
        );
      }
      if (table === "profiles") {
        return read(
          "read:profiles",
          () => ({ data: state.displayName ? { display_name: state.displayName } : null }),
          true,
        );
      }
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from: () => ({
        remove: vi.fn(async () => ({ error: state.removeError })),
        createSignedUploadUrl: vi.fn(async () => {
          await state.signedUrlDelay;
          return { data: { signedUrl: "https://storage.test/upload" }, error: null };
        }),
      }),
    },
  };

  return { state, supabase, createNotification, getUser, gate };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/notifications", () => ({ createNotification: h.createNotification }));

import { discardMessageAttachment, sendMessage, uploadMessageAttachment } from "./messages";

beforeEach(() => {
  Object.assign(h.state, {
    session: { user: { id: ME } },
    insertError: null,
    acceptedBy: [],
    participants: [ME, THEM],
    displayName: "Sam",
    myMessageCount: 1,
    removeError: null,
    signedUrlDelay: null,
    log: [],
    inserted: [],
    readsInFlight: 0,
    maxReadsInFlight: 0,
  });
  h.createNotification.mockClear();
  h.getUser.mockClear();
  h.gate.current = Promise.resolve();
});

describe("sendMessage", () => {
  it("takes the sender from the local session instead of asking the auth server", async () => {
    await sendMessage("c1", "hi");
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.state.inserted[0]).toMatchObject({ conversation_id: "c1", sender_id: ME, body: "hi" });
  });

  it("refuses when nobody is signed in", async () => {
    h.state.session = null;
    await expect(sendMessage("c1", "hi")).rejects.toThrow("Sign in to send messages.");
    expect(h.state.inserted).toHaveLength(0);
  });

  it("does nothing for an empty message with no attachment", async () => {
    await sendMessage("c1", "   ");
    expect(h.state.inserted).toHaveLength(0);
  });

  it("stores the message before it looks anything else up", async () => {
    await sendMessage("c1", "hi");
    expect(h.state.log[0]).toBe("insert");
  });

  it("reads the thread's details at the same time, not one after another", async () => {
    await sendMessage("c1", "hi");
    expect(h.state.maxReadsInFlight).toBe(3);
  });

  it("does not notify anyone when the insert fails", async () => {
    h.state.insertError = new Error("rls");
    await expect(sendMessage("c1", "hi")).rejects.toThrow("rls");
    expect(h.createNotification).not.toHaveBeenCalled();
  });

  it("is done once the message is stored, without waiting for notifications", async () => {
    let release!: () => void;
    h.gate.current = new Promise<void>((r) => (release = r));
    h.state.acceptedBy = [THEM];

    const outcome = await Promise.race([
      sendMessage("c1", "hi").then(() => "returned"),
      new Promise((r) => setTimeout(() => r("still waiting"), 200)),
    ]);
    expect(outcome).toBe("returned");
    expect(h.createNotification).toHaveBeenCalledTimes(1);
    release();
  });

  it("does not let a failing notification break a send that already went through", async () => {
    h.state.acceptedBy = [THEM];
    h.createNotification.mockImplementationOnce(() => Promise.reject(new Error("push down")));
    await expect(sendMessage("c1", "hi")).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("sendMessage — who hears about it", () => {
  it("tells a known contact about every message, with a preview", async () => {
    h.state.acceptedBy = [THEM];
    await sendMessage("c1", "see you at 7");
    expect(h.createNotification).toHaveBeenCalledWith({
      user_id: THEM,
      type: "message",
      title: "New message from Sam",
      body: "see you at 7",
      link: "/messages/c1",
    });
    // No need to count anything for someone who already accepted.
    expect(h.state.log).not.toContain("count");
  });

  it("previews an attachment-only message by its name", async () => {
    h.state.acceptedBy = [THEM];
    await sendMessage("c1", "", {
      path: "c1/me/1-a.jpg",
      type: "image/jpeg",
      name: "a.jpg",
      size: 9,
    });
    expect(h.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ body: "📎 a.jpg" }),
    );
  });

  it("tells a stranger about the opening message — without quoting it", async () => {
    h.state.acceptedBy = [ME];
    h.state.myMessageCount = 1;
    await sendMessage("c1", "secret words");
    expect(h.createNotification).toHaveBeenCalledTimes(1);
    expect(h.createNotification).toHaveBeenCalledWith({
      user_id: THEM,
      type: "message",
      title: "Message request from Sam",
      body: "They'd like to start a conversation.",
      link: "/messages/c1",
    });
  });

  it("does not notify a stranger again for later messages", async () => {
    h.state.acceptedBy = [ME];
    h.state.myMessageCount = 2;
    await sendMessage("c1", "hello?");
    expect(h.createNotification).not.toHaveBeenCalled();
  });

  it("counts the sender's messages before returning, so a quick second message cannot hide the first", async () => {
    h.state.acceptedBy = [ME];
    await sendMessage("c1", "hi");
    // Already counted by the time the caller can send another.
    expect(h.state.log).toEqual([
      "insert",
      expect.stringMatching(/^read:/),
      expect.stringMatching(/^read:/),
      expect.stringMatching(/^read:/),
      "count",
    ]);
  });

  it("falls back to a neutral name when the sender has no profile name", async () => {
    h.state.acceptedBy = [THEM];
    h.state.displayName = null;
    await sendMessage("c1", "hi");
    expect(h.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New message from Someone" }),
    );
  });
});

describe("uploadMessageAttachment", () => {
  const photo = () => new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" });

  it("takes the uploader from the local session instead of asking the auth server", async () => {
    h.state.session = null;
    await expect(uploadMessageAttachment("c1", photo())).rejects.toThrow(
      "Sign in to send attachments.",
    );
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("rejects instead of hanging when cancelled before the transfer starts", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      uploadMessageAttachment("c1", photo(), { signal: ctrl.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects instead of hanging when cancelled while the upload URL is being made", async () => {
    const ctrl = new AbortController();
    h.state.signedUrlDelay = new Promise<void>((r) => setTimeout(r, 10));
    const pending = uploadMessageAttachment("c1", photo(), { signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("still refuses an oversized file", async () => {
    const big = new File([new Uint8Array(1)], "big.bin");
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    await expect(uploadMessageAttachment("c1", big)).rejects.toThrow("too large");
  });
});

describe("discardMessageAttachment", () => {
  it("removes the stored file", async () => {
    await expect(discardMessageAttachment("c1/me/1-a.jpg")).resolves.toBeUndefined();
  });

  it("never throws, so cleaning up cannot break the caller", async () => {
    h.state.removeError = new Error("storage down");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(discardMessageAttachment("c1/me/1-a.jpg")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
