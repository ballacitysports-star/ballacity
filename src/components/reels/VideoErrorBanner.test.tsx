import { describe, expect, it, vi } from "vitest";

// video-transcode reads the ffmpeg core URL through the Supabase client at
// module scope, and this file imports its error classes. Same stub as
// src/lib/video-transcode.test.ts.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "https://x/y" } }) }) },
  },
}));

const { classifyUploadError, isRetryableVideoError } = await import(
  "@/components/reels/VideoErrorBanner"
);
const { ClipConversionFailedError, ConverterUnavailableError } = await import(
  "@/lib/video-transcode"
);
const { UPLOAD_REJECTED } = await import("@/lib/video-validation");

describe("classifyUploadError", () => {
  it("separates an outage from a clip this device couldn't encode", () => {
    // The whole point of the split: one says "wait", the other says "re-export".
    expect(classifyUploadError(new ConverterUnavailableError()).kind).toBe("converter_outage");
    expect(classifyUploadError(new ClipConversionFailedError()).kind).toBe("unsupported_format");
  });

  it("reads the server's container-sniff rejection as a format problem", () => {
    expect(classifyUploadError(new Error(UPLOAD_REJECTED.unplayable)).kind).toBe(
      "unsupported_format",
    );
    // The message crosses a server-function boundary, so a wrapper around it
    // must not change the advice the athlete gets.
    expect(classifyUploadError(new Error(`500: ${UPLOAD_REJECTED.unplayable}`)).kind).toBe(
      "unsupported_format",
    );
  });

  it("keeps the size cap its own case, so the advice can name the limit", () => {
    const out = classifyUploadError(new Error(UPLOAD_REJECTED.tooLarge));
    expect(out.kind).toBe("too_large");
    expect(out.message).toBe(UPLOAD_REJECTED.tooLarge);
  });

  it("treats a dropped connection as retryable with the same clip", () => {
    expect(classifyUploadError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(classifyUploadError(new Error("NetworkError when attempting to fetch")).kind).toBe(
      "network",
    );
    // Safari's wording for the same failure.
    expect(classifyUploadError(new Error("Load failed")).kind).toBe("network");
  });

  it("explains an empty file rather than offering to trim it", () => {
    const out = classifyUploadError(new Error(UPLOAD_REJECTED.empty));
    expect(out.kind).toBe("unknown");
    expect(out.message).toBe(UPLOAD_REJECTED.empty);
  });

  it("never returns an unexplained failure", () => {
    expect(classifyUploadError(null).message).toBeTruthy();
    expect(classifyUploadError(undefined).kind).toBe("unknown");
    expect(classifyUploadError({ weird: true }).message).toBeTruthy();
  });
});

describe("isRetryableVideoError", () => {
  it("re-sends the same clip only for transient failures", () => {
    expect(isRetryableVideoError("network")).toBe(true);
    expect(isRetryableVideoError("converter_outage")).toBe(true);
    // Re-sending these would fail identically a second time.
    expect(isRetryableVideoError("unsupported_format")).toBe(false);
    expect(isRetryableVideoError("too_large")).toBe(false);
    expect(isRetryableVideoError("unknown")).toBe(false);
  });
});
