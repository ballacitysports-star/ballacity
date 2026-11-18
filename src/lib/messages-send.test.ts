import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
            // insert(...).select().single(): the stored row comes back.
            return {
              select: () => ({
                single: () =>
                  Promise.resolve(
                    state.insertError
                      ? { data: null, error: state.insertError }
                      : { data: { id: "m-new", ...row }, error: null },
                  ),
              }),
            };
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

  const finalize = vi.fn(async (_a: { data: { path: string } }) => ({
    ok: true as const,
    kind: "image" as const,
    mime: "image/jpeg",
    bytes: 10,
  }));
  return { state, supabase, createNotification, getUser, gate, finalize };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/notifications", () => ({ createNotification: h.createNotification }));
vi.mock("@/lib/message-attachments.functions", () => ({ finalizeMessageAttachment: h.finalize }));

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
    await expect(sendMessage("c1", "   ")).resolves.toBeNull();
    expect(h.state.inserted).toHaveLength(0);
  });

  it("hands back the stored message so the sender can show it straight away", async () => {
    const sent = await sendMessage("c1", "see you at 7");
    expect(sent).toMatchObject({
      id: "m-new",
      conversation_id: "c1",
      sender_id: ME,
      body: "see you at 7",
    });
  });

  it("stores the message, then asks the server to tell the thread about it, reading nothing itself", async () => {
    await sendMessage("c1", "hi");
    expect(h.state.log).toEqual(["insert"]);
    // The server reads the thread, who accepted it and whether this is the opening message, and writes the
    // text (notification-plan.server.test.ts); the app only names the stored message.
    expect(h.createNotification).toHaveBeenCalledTimes(1);
    expect(h.createNotification).toHaveBeenCalledWith({ type: "message", message_id: "m-new" });
  });

  it("does not notify anyone when the insert fails", async () => {
    h.state.insertError = new Error("rls");
    await expect(sendMessage("c1", "hi")).rejects.toThrow("rls");
    expect(h.createNotification).not.toHaveBeenCalled();
  });

  it("is done once the message is stored, without waiting for notifications", async () => {
    let release!: () => void;
    h.gate.current = new Promise<void>((r) => (release = r));

    const outcome = await Promise.race([
      sendMessage("c1", "hi").then(() => "returned"),
      new Promise((r) => setTimeout(() => r("still waiting"), 200)),
    ]);
    expect(outcome).toBe("returned");
    expect(h.createNotification).toHaveBeenCalledTimes(1);
    release();
  });

  it("does not let a failing notification break a send that already went through", async () => {
    h.createNotification.mockImplementationOnce(() => Promise.reject(new Error("push down")));
    await expect(sendMessage("c1", "hi")).resolves.toMatchObject({ id: "m-new" });
    await new Promise((r) => setTimeout(r, 0));
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

describe("uploadMessageAttachment: server check", () => {
  const photo = () => new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" });
  class OkXhr {
    status = 200;
    upload = {} as { onprogress?: unknown };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open() {}
    setRequestHeader() {}
    send() {
      queueMicrotask(() => this.onload?.());
    }
    abort() {}
  }

  beforeEach(() => {
    vi.stubGlobal("XMLHttpRequest", OkXhr);
    h.finalize.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a file type the server would refuse, before uploading", async () => {
    const zip = new File([new Uint8Array(10)], "a.zip", { type: "application/zip" });
    await expect(uploadMessageAttachment("c1", zip)).rejects.toThrow("not allowed");
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it("hands back the type and size the server checked, not the browser's", async () => {
    h.finalize.mockResolvedValueOnce({ ok: true, kind: "image", mime: "image/png", bytes: 99 });
    const a = await uploadMessageAttachment("c1", photo());
    expect(h.finalize).toHaveBeenCalledWith({
      data: { path: expect.stringMatching(/^c1\/me-id\//) },
    });
    expect(a).toMatchObject({ type: "image/png", size: 99, name: "a.jpg" });
  });

  it("rejects, and cleans up, when the server refuses the file", async () => {
    h.finalize.mockRejectedValueOnce(new Error("That file type is not allowed."));
    await expect(uploadMessageAttachment("c1", photo())).rejects.toThrow("not allowed");
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
