import { describe, expect, it, vi } from "vitest";
import type { Attachment, UploadOptions } from "./messages";
import {
  createAttachmentUploader,
  isAbortError,
  type UploaderDeps,
  type UploaderState,
} from "./attachment-uploader";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const file = (name: string, size = 1000) =>
  new File([new Uint8Array(size)], name, { type: "image/jpeg" });
const attachmentFor = (f: File): Attachment => ({
  path: `conv/me/${f.name}`,
  type: f.type,
  name: f.name,
  size: f.size,
});

/** Let queued promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

type Upload = {
  file: File;
  opts: UploadOptions;
  done: ReturnType<typeof deferred<Attachment>>;
};

/**
 * Fake collaborators the test drives by hand. `upload` ignores its abort
 * signal on purpose — a real transfer can finish in the instant before the
 * abort lands, and the uploader must cope with that.
 */
function setup(over: Partial<UploaderDeps> = {}) {
  const uploads: Upload[] = [];
  const discarded: string[] = [];
  const states: UploaderState[] = [];
  const deps: UploaderDeps = {
    compress: vi.fn(async (f: File) => new File([new Uint8Array(100)], f.name, { type: f.type })),
    upload: vi.fn((f: File, opts: UploadOptions) => {
      const done = deferred<Attachment>();
      uploads.push({ file: f, opts, done });
      return done.promise;
    }),
    discard: vi.fn((path: string) => {
      discarded.push(path);
    }),
    ...over,
  };
  const uploader = createAttachmentUploader(deps, (s) => states.push(s));
  const last = () => states.at(-1)!;
  return { uploader, deps, uploads, discarded, states, last };
}

describe("uploading in the background", () => {
  it("starts on pick: shrinks, uploads the shrunken copy, and becomes ready", async () => {
    const { uploader, uploads, last, states } = setup();
    const photo = file("a.jpg", 5_000_000);
    uploader.pick(photo, true);
    expect(last().phase).toBe("preparing");
    expect(last().file).toBe(photo);

    await flush();
    expect(last().phase).toBe("uploading");
    // The composer now shows the file that is actually being sent.
    expect(last().file!.size).toBe(100);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.file.size).toBe(100);

    uploads[0]!.opts.onProgress?.(40);
    expect(last().pct).toBe(40);

    uploads[0]!.done.resolve(attachmentFor(uploads[0]!.file));
    await flush();
    expect(last().phase).toBe("ready");
    expect(last().pct).toBe(100);
    expect(states.map((s) => s.phase)).toEqual([
      "idle",
      "preparing",
      "uploading",
      "uploading",
      "ready",
    ]);
  });

  it("does not start by itself when told not to, and Send starts it", async () => {
    const { uploader, deps, uploads, last } = setup();
    uploader.pick(file("a.jpg"), false);
    await flush();
    expect(deps.compress).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
    expect(last().phase).toBe("idle");

    const sent = uploader.ensure();
    await flush();
    expect(uploads).toHaveLength(1);
    uploads[0]!.done.resolve(attachmentFor(uploads[0]!.file));
    await expect(sent).resolves.toMatchObject({ name: "a.jpg" });
  });

  it("Send during the upload waits for it instead of starting another", async () => {
    const { uploader, deps, uploads } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();

    const sent = uploader.ensure();
    uploads[0]!.done.resolve(attachmentFor(uploads[0]!.file));
    await expect(sent).resolves.toMatchObject({ name: "a.jpg" });
    expect(deps.upload).toHaveBeenCalledTimes(1);
  });

  it("Send after a finished upload reuses it, even more than once", async () => {
    // The message insert can fail after the upload succeeded; trying again
    // must not upload the same file a second time.
    const { uploader, deps, uploads } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();
    uploads[0]!.done.resolve(attachmentFor(uploads[0]!.file));
    await flush();

    const first = await uploader.ensure();
    const second = await uploader.ensure();
    expect(second).toEqual(first);
    expect(deps.upload).toHaveBeenCalledTimes(1);
  });

  it("resolves null when nothing is picked", async () => {
    const { uploader } = setup();
    await expect(uploader.ensure()).resolves.toBeNull();
  });

  it("falls back to the original file when shrinking fails", async () => {
    const { uploader, uploads } = setup({
      compress: vi.fn(async () => {
        throw new Error("decode failed");
      }),
    });
    const photo = file("a.jpg", 4000);
    uploader.pick(photo, true);
    await flush();
    expect(uploads[0]!.file).toBe(photo);
  });

  it("falls back to the original file when shrinking throws synchronously", async () => {
    const { uploader, uploads } = setup({
      compress: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    const photo = file("a.jpg", 4000);
    uploader.pick(photo, true);
    await flush();
    expect(uploads[0]!.file).toBe(photo);
  });
});

describe("replacing, removing and leaving", () => {
  it("picking another file stops the first and ignores its late result", async () => {
    const { uploader, uploads, discarded, last } = setup();
    uploader.pick(file("first.jpg"), true);
    await flush();
    const first = uploads[0]!;

    uploader.pick(file("second.jpg"), true);
    expect(first.opts.signal!.aborted).toBe(true);
    await flush();
    expect(uploads).toHaveLength(2);

    // The first transfer finishes anyway, after being stopped.
    first.done.resolve(attachmentFor(first.file));
    await flush();
    expect(discarded).toEqual(["conv/me/first.jpg"]);
    // And it did not touch what the composer shows for the second file.
    expect(last().file!.name).toBe("second.jpg");
    expect(last().phase).toBe("uploading");

    uploads[1]!.done.resolve(attachmentFor(uploads[1]!.file));
    await flush();
    expect(last().phase).toBe("ready");
    await expect(uploader.ensure()).resolves.toMatchObject({ name: "second.jpg" });
  });

  it("removing a file that already uploaded deletes it from storage once", async () => {
    const { uploader, uploads, discarded, last } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();
    uploads[0]!.done.resolve(attachmentFor(uploads[0]!.file));
    await flush();

    uploader.clear();
    await flush();
    expect(discarded).toEqual(["conv/me/a.jpg"]);
    expect(last()).toMatchObject({ file: null, phase: "idle" });
    await expect(uploader.ensure()).resolves.toBeNull();
  });

  it("removing a file mid-upload stops it, and deletes it if it lands anyway", async () => {
    const { uploader, uploads, discarded, last } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();

    uploader.clear();
    expect(uploads[0]!.opts.signal!.aborted).toBe(true);
    uploads[0]!.done.resolve(attachmentFor(uploads[0]!.file));
    await flush();
    expect(discarded).toEqual(["conv/me/a.jpg"]);
    expect(last().file).toBeNull();
  });

  it("a file that became a message is released, not deleted", async () => {
    const { uploader, uploads, discarded, last } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();
    uploads[0]!.done.resolve(attachmentFor(uploads[0]!.file));
    await flush();
    await uploader.ensure();

    uploader.release();
    await flush();
    expect(discarded).toEqual([]);
    expect(last()).toMatchObject({ file: null, phase: "idle" });
  });

  it("leaving the thread stops the upload, deletes what arrived, and goes quiet", async () => {
    const { uploader, uploads, discarded, states } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();
    uploads[0]!.done.resolve(attachmentFor(uploads[0]!.file));
    await flush();
    const seen = states.length;

    uploader.dispose();
    await flush();
    expect(discarded).toEqual(["conv/me/a.jpg"]);
    expect(states).toHaveLength(seen);
  });

  it("does not report anything after dispose, even for an upload still running", async () => {
    const { uploader, uploads, discarded, states } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();
    const seen = states.length;

    uploader.dispose();
    uploads[0]!.opts.onProgress?.(70);
    uploads[0]!.done.resolve(attachmentFor(uploads[0]!.file));
    await flush();
    expect(states).toHaveLength(seen);
    expect(discarded).toEqual(["conv/me/a.jpg"]);
  });

  it("survives a delete that fails", async () => {
    const { uploader, uploads } = setup({
      discard: vi.fn(async () => {
        throw new Error("storage down");
      }),
    });
    uploader.pick(file("a.jpg"), true);
    await flush();
    uploads[0]!.done.resolve(attachmentFor(uploads[0]!.file));
    await flush();
    expect(() => uploader.clear()).not.toThrow();
    await flush();
  });
});

describe("cancel, failure and retry", () => {
  it("cancel stops the transfer but keeps the file for Send to restart", async () => {
    const { uploader, uploads, last } = setup();
    const photo = file("a.jpg");
    uploader.pick(photo, true);
    await flush();

    uploader.cancel();
    expect(uploads[0]!.opts.signal!.aborted).toBe(true);
    expect(last().phase).toBe("idle");
    expect(last().file).not.toBeNull();

    const sent = uploader.ensure();
    await flush();
    expect(uploads).toHaveLength(2);
    uploads[1]!.done.resolve(attachmentFor(uploads[1]!.file));
    await expect(sent).resolves.toMatchObject({ name: "a.jpg" });
  });

  it("Send waiting on an upload that is then cancelled gets an abort, not a failure", async () => {
    const { uploader, last } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();

    const sent = uploader.ensure();
    uploader.cancel();
    const err = await sent.catch((e) => e);
    expect(isAbortError(err)).toBe(true);
    expect(last().phase).toBe("idle");
    expect(last().error).toBeNull();
  });

  it("shows a failure, and Send then starts a fresh upload", async () => {
    const { uploader, uploads, last } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();
    uploads[0]!.done.reject(new Error("Network error during upload."));
    await flush();
    expect(last()).toMatchObject({ phase: "failed", error: "Network error during upload." });

    const sent = uploader.ensure();
    await flush();
    expect(uploads).toHaveLength(2);
    uploads[1]!.done.resolve(attachmentFor(uploads[1]!.file));
    await expect(sent).resolves.toMatchObject({ name: "a.jpg" });
    expect(last().phase).toBe("ready");
    expect(last().error).toBeNull();
  });

  it("Send reports the failure of the upload it was waiting on", async () => {
    const { uploader, uploads } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();
    const sent = uploader.ensure();
    uploads[0]!.done.reject(new Error("Upload failed (413)"));
    await expect(sent).rejects.toThrow("Upload failed (413)");
  });

  it("retry uploads again from the original file", async () => {
    const photo = file("a.jpg", 5000);
    const { uploader, deps, uploads, last } = setup();
    uploader.pick(photo, true);
    await flush();
    uploads[0]!.done.reject(new Error("Network error during upload."));
    await flush();

    uploader.retry();
    await flush();
    expect(deps.compress).toHaveBeenLastCalledWith(photo);
    expect(uploads).toHaveLength(2);
    uploads[1]!.done.resolve(attachmentFor(uploads[1]!.file));
    await flush();
    expect(last().phase).toBe("ready");
  });

  it("falls back to a readable message when the error has none", async () => {
    const { uploader, uploads, last } = setup();
    uploader.pick(file("a.jpg"), true);
    await flush();
    uploads[0]!.done.reject({});
    await flush();
    expect(last().error).toBe("Upload failed");
  });
});
