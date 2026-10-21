/**
 * Uploads a chat attachment in the background while the sender is still
 * composing, so that Send only has to wait for whatever is left.
 *
 * Until now nothing happened when a file was picked: the upload began when
 * Send was tapped, so the whole transfer sat between the tap and the message
 * appearing. Here it starts on pick (after the image is shrunk) and Send picks
 * up the result — or, if the upload is still running, waits for it.
 *
 * The rules this keeps:
 * - One upload at a time. Picking another file, removing it, or leaving the
 *   thread stops the running one.
 * - A file that reached storage but never became a message is removed again.
 * - Late results from a stopped upload are ignored, so a slow transfer can
 *   never overwrite the file the user picked after it.
 * - Send after a failure starts a fresh upload; Send after a successful upload
 *   (e.g. the message insert failed) reuses it instead of uploading twice.
 *
 * Framework-free on purpose: the races above are what need testing.
 */

import type { Attachment, UploadOptions } from "@/lib/messages";

export type UploadPhase = "idle" | "preparing" | "uploading" | "ready" | "failed";

export type UploaderState = {
  /** What the composer shows: the picked file, then the shrunken copy once it exists. */
  file: File | null;
  phase: UploadPhase;
  pct: number;
  error: string | null;
};

export const IDLE_UPLOADER: UploaderState = { file: null, phase: "idle", pct: 0, error: null };

export type UploaderDeps = {
  /** Shrink the file for upload; resolves with the original when it cannot. */
  compress: (file: File) => Promise<File>;
  upload: (file: File, opts: UploadOptions) => Promise<Attachment>;
  /** Remove an uploaded file that was never sent. */
  discard: (path: string) => unknown;
};

type Job = {
  ctrl: AbortController;
  /** Set once the file is in storage. */
  attachment: Attachment | null;
  /** The stored file has been removed (or is being), so never remove it twice. */
  discarded: boolean;
  promise: Promise<Attachment>;
};

export function isAbortError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === "AbortError";
}

const abortError = () => new DOMException("Upload cancelled", "AbortError");

function messageOf(e: unknown): string {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && m ? m : "Upload failed";
}

export function createAttachmentUploader(
  deps: UploaderDeps,
  onChange: (state: UploaderState) => void,
) {
  let state = IDLE_UPLOADER;
  /** As picked, before shrinking — what a retry starts from. */
  let picked: File | null = null;
  let job: Job | null = null;
  let disposed = false;

  const publish = (next: UploaderState) => {
    state = next;
    if (!disposed) onChange(state);
  };

  /** Remove a job's stored file, once, however the stop and the arrival interleave. */
  const discardFor = (j: Job, path: string) => {
    if (j.discarded) return;
    j.discarded = true;
    void Promise.resolve()
      .then(() => deps.discard(path))
      .catch(() => {});
  };

  /** Stop the running job, removing its file if it had already arrived. */
  const stop = () => {
    const j = job;
    job = null;
    if (!j) return;
    j.ctrl.abort();
    if (j.attachment) discardFor(j, j.attachment.path);
  };

  const start = (file: File): Job => {
    stop();
    const ctrl = new AbortController();
    const j: Job = {
      ctrl,
      attachment: null,
      discarded: false,
      promise: undefined as unknown as Promise<Attachment>,
    };
    job = j;
    // Updates only count while this job is still the current one.
    const live = () => job === j;
    publish({ file, phase: "preparing", pct: 0, error: null });

    j.promise = (async () => {
      try {
        const ready = await Promise.resolve()
          .then(() => deps.compress(file))
          .catch(() => file);
        if (ctrl.signal.aborted) throw abortError();
        if (live()) publish({ file: ready, phase: "uploading", pct: 0, error: null });

        const transfer = deps.upload(ready, {
          signal: ctrl.signal,
          onProgress: (pct) => {
            if (live()) publish({ ...state, pct });
          },
        });
        // A transfer that cannot be interrupted may still finish after the
        // stop; whatever it stored then belongs to nobody.
        transfer.then(
          (a) => {
            if (ctrl.signal.aborted) discardFor(j, a.path);
          },
          () => {},
        );
        // Whoever is waiting is released the moment the job is stopped, whether
        // or not the transfer underneath honours the signal.
        const attachment = await Promise.race([
          transfer,
          new Promise<never>((_, reject) => {
            if (ctrl.signal.aborted) reject(abortError());
            else ctrl.signal.addEventListener("abort", () => reject(abortError()), { once: true });
          }),
        ]);
        // Stopped while the last bytes were in flight: nobody will send this.
        if (ctrl.signal.aborted) {
          discardFor(j, attachment.path);
          throw abortError();
        }
        j.attachment = attachment;
        if (live()) publish({ ...state, phase: "ready", pct: 100 });
        return attachment;
      } catch (e) {
        if (live()) {
          // A failed job is over; the next Send starts a new one.
          job = null;
          publish(
            isAbortError(e)
              ? { ...state, phase: "idle", pct: 0 }
              : { ...state, phase: "failed", error: messageOf(e) },
          );
        }
        throw e;
      }
    })();
    // Nobody is waiting yet while the user is still typing.
    j.promise.catch(() => {});
    return j;
  };

  return {
    getState: () => state,

    /** A file was chosen. Replaces any earlier one; `autoStart` begins uploading now. */
    pick(file: File, autoStart: boolean) {
      stop();
      picked = file;
      publish({ file, phase: "idle", pct: 0, error: null });
      if (autoStart) start(file);
    },

    /**
     * The attachment to send: the finished upload, the running one once it
     * lands, or a fresh upload when none is going. Null when nothing is picked.
     */
    ensure(): Promise<Attachment | null> {
      if (!picked) return Promise.resolve(null);
      return (job ?? start(picked)).promise;
    },

    /** Upload again from the original file. */
    retry() {
      if (picked) start(picked);
    },

    /** Stop the transfer but keep the file, so Send or Retry can restart it. */
    cancel() {
      stop();
      if (state.file) publish({ ...state, phase: "idle", pct: 0, error: null });
    },

    /** Drop the file, and its upload if there is one. */
    clear() {
      stop();
      picked = null;
      publish(IDLE_UPLOADER);
    },

    /** The attachment became a message: forget it without deleting the file. */
    release() {
      job = null;
      picked = null;
      publish(IDLE_UPLOADER);
    },

    /** The thread is gone. Stop, clean up, and report nothing further. */
    dispose() {
      disposed = true;
      stop();
      picked = null;
    },
  };
}

export type AttachmentUploader = ReturnType<typeof createAttachmentUploader>;
