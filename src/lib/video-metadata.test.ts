import { describe, expect, it } from "vitest";
import { buildMediaMeta, orientationOf } from "./video-metadata";

const file = { name: "clip.mov", type: "video/quicktime", size: 1024 };
const original = {
  width: 1080,
  height: 1920,
  durationSeconds: 12.5,
  orientation: "portrait" as const,
};

describe("orientationOf", () => {
  it("reads phone footage as portrait and camera footage as landscape", () => {
    expect(orientationOf(1080, 1920)).toBe("portrait");
    expect(orientationOf(1920, 1080)).toBe("landscape");
    expect(orientationOf(720, 720)).toBe("square");
  });

  it("stays unknown rather than guessing when dimensions are missing", () => {
    expect(orientationOf(null, 1920)).toBeNull();
    expect(orientationOf(0, 0)).toBeNull();
  });
});

describe("buildMediaMeta", () => {
  it("marks a converted clip ready and keeps both copies' facts", () => {
    const meta = buildMediaMeta({
      file,
      original,
      processed: {
        width: 1080,
        height: 1920,
        durationSeconds: 12.5,
        orientation: "portrait",
        bytes: 800,
        pass: "standard",
      },
      conversionAttempted: true,
    });
    expect(meta.playback_status).toBe("ready");
    expect(meta.playback_error).toBeNull();
    expect(meta.original.filename).toBe("clip.mov");
    expect(meta.processed?.mime).toBe("video/mp4");
    expect(meta.processed?.pass).toBe("standard");
  });

  it("marks a clip that never needed conversion as original, not failed", () => {
    const meta = buildMediaMeta({ file, original, conversionAttempted: false });
    expect(meta.playback_status).toBe("original");
    expect(meta.processed).toBeNull();
  });

  it("records a real failure instead of implying the clip is fine", () => {
    const meta = buildMediaMeta({
      file,
      original,
      conversionAttempted: true,
      playbackError: "This device could not convert the clip",
    });
    expect(meta.playback_status).toBe("failed");
    expect(meta.playback_error).toBe("This device could not convert the clip");
  });
});
