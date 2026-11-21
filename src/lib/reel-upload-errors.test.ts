import { describe, expect, it } from "vitest";
import { StorageApiError } from "@supabase/supabase-js";
import {
  clipLengthProblem,
  clipLimitsFor,
  resolutionProblem,
  uploadSizeProblem,
} from "@/lib/ai/upload-limits";
import {
  REEL_CONVERTER_UNAVAILABLE_MESSAGE,
  REEL_STORAGE_FAILED_MESSAGE,
  REEL_UPLOAD_FALLBACK,
  ReelUploadProblem,
  isReelServerRefusal,
  reelUploadErrorMessage,
} from "@/lib/reel-upload-errors";
import { GENERIC_ERROR_MESSAGES, USER_ERROR_MESSAGES } from "@/lib/user-error";
import {
  VIDEO_EMPTY_MESSAGE,
  VIDEO_NOT_PLAYABLE_MESSAGE,
  VIDEO_TOO_LARGE_MESSAGE,
  VIDEO_UPLOAD_MISSING_MESSAGE,
  validateVideoSize,
} from "@/lib/video-validation";

const limits = clipLimitsFor(
  "free" as never,
  {
    maxUploadMb: 50,
    maxVideoSeconds: 60,
    maxResolution: 1280,
    maxProcessingSeconds: 120,
  } as never,
);

/** What a server function's refusal looks like once it reaches the browser: a plain Error with the sentence. */
const fromServer = (message: string) => new Error(message);

describe("reelUploadErrorMessage", () => {
  it("shows the page's own refusals as they are", () => {
    expect(reelUploadErrorMessage(new ReelUploadProblem("This clip is too long."))).toBe(
      "This clip is too long.",
    );
  });

  it("says the converter is unavailable", () => {
    const e = Object.assign(new Error("Video conversion is unavailable"), {
      name: "ConverterUnavailableError",
    });
    expect(reelUploadErrorMessage(e)).toBe(REEL_CONVERTER_UNAVAILABLE_MESSAGE);
  });

  it("shows finalizeVideoUpload's fixed refusals as they are", () => {
    for (const s of [
      VIDEO_TOO_LARGE_MESSAGE,
      VIDEO_EMPTY_MESSAGE,
      VIDEO_NOT_PLAYABLE_MESSAGE,
      VIDEO_UPLOAD_MISSING_MESSAGE,
    ]) {
      expect(reelUploadErrorMessage(fromServer(s))).toBe(s);
    }
    // The client check and the server share the wording.
    expect(validateVideoSize({ bytes: 0 })).toBe(VIDEO_EMPTY_MESSAGE);
    expect(validateVideoSize({ bytes: 201 * 1024 * 1024 })).toBe(VIDEO_TOO_LARGE_MESSAGE);
    expect(VIDEO_TOO_LARGE_MESSAGE).toBe("Video is too large (max 200 MB)");
  });

  it("tells a member why the server's plan re-check refused the clip", () => {
    const size = uploadSizeProblem(80 * 1024 * 1024, limits)!;
    const length = clipLengthProblem(125, limits)!;
    const res = resolutionProblem({ width: 1920, height: 1080 }, limits)!;
    for (const s of [size, length, res]) {
      expect(s).toBeTruthy();
      expect(isReelServerRefusal(s)).toBe(true);
      expect(reelUploadErrorMessage(fromServer(s))).toBe(s);
    }
    expect(size).toMatch(/Your plan allows uploads up to 50 MB/);
    expect(length).toMatch(/Your plan allows clips up to 1:00/);
  });

  it("matches the plan sentences whole, not text that merely contains them", () => {
    const s = clipLengthProblem(125, limits)!;
    expect(isReelServerRefusal(`Error: ${s} at finalize`)).toBe(false);
    expect(reelUploadErrorMessage(fromServer(`Error: ${s} at finalize`))).toBe(
      REEL_UPLOAD_FALLBACK,
    );
  });

  it("gives a Storage size refusal the size sentence, never the storage text", () => {
    const e413 = new StorageApiError("The object exceeded the maximum allowed size", 413, "413");
    expect(reelUploadErrorMessage(e413)).toBe(VIDEO_TOO_LARGE_MESSAGE);
    // As a plain object, the way it can arrive after crossing a boundary.
    expect(
      reelUploadErrorMessage({
        name: "StorageApiError",
        message: "Payload too large",
        statusCode: "413",
      }),
    ).toBe(VIDEO_TOO_LARGE_MESSAGE);
  });

  it("words any other Storage failure without its raw text", () => {
    const e = new StorageApiError("Internal Server Error: bucket highlight-videos", 500, "500");
    const msg = reelUploadErrorMessage(e);
    expect(msg).toBe(REEL_STORAGE_FAILED_MESSAGE);
    expect(msg).not.toMatch(/bucket|Internal Server Error/);
  });

  it("reads a Storage network failure, session end or refused write as such", () => {
    // storage-js wraps a failed fetch in a StorageUnknownError.
    const offline = Object.assign(new Error("Failed to fetch"), {
      name: "StorageUnknownError",
      __isStorageError: true,
    });
    expect(reelUploadErrorMessage(offline)).toBe(GENERIC_ERROR_MESSAGES.offline);
    const rls = new StorageApiError("new row violates row-level security policy", 403, "403");
    expect(reelUploadErrorMessage(rls)).toBe(GENERIC_ERROR_MESSAGES.permission);
  });

  it("maps PostgREST and network errors through userErrorMessage", () => {
    expect(reelUploadErrorMessage(new TypeError("Failed to fetch"))).toBe(
      GENERIC_ERROR_MESSAGES.offline,
    );
    expect(
      reelUploadErrorMessage({
        message: "permission denied for table highlight_reels",
        code: "42501",
      }),
    ).toBe(GENERIC_ERROR_MESSAGES.permission);
    // A coded refusal from the reel insert keeps its catalog sentence.
    expect(reelUploadErrorMessage(new Error("CHILD_ACTIVITY_LOCKED"))).toBe(
      USER_ERROR_MESSAGES.CHILD_ACTIVITY_LOCKED,
    );
  });

  it("falls back for anything unknown, never showing raw text", () => {
    expect(reelUploadErrorMessage(new Error("relation x does not exist"))).toBe(
      REEL_UPLOAD_FALLBACK,
    );
    expect(reelUploadErrorMessage(undefined)).toBe(REEL_UPLOAD_FALLBACK);
  });
});
