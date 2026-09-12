import { describe, expect, it } from "vitest";
import {
  buildMediaRef,
  isMediaRef,
  isPrivateMediaBucket,
  parseMediaRef,
  parseStorageMediaUrl,
  resolvableMediaRef,
} from "@/lib/media-refs";
import {
  sniffVideoContainer,
  validateVideoSize,
  MAX_VIDEO_BYTES,
} from "@/lib/video-validation";

describe("media refs", () => {
  it("round-trips a bucket and path", () => {
    const ref = buildMediaRef("game-covers", "user-1/cover.jpg");
    expect(ref).toBe("storage://game-covers/user-1/cover.jpg");
    expect(isMediaRef(ref)).toBe(true);
    expect(parseMediaRef(ref)).toEqual({ bucket: "game-covers", path: "user-1/cover.jpg" });
  });

  it("classifies private vs public buckets", () => {
    expect(isPrivateMediaBucket("game-covers")).toBe(true);
    expect(isPrivateMediaBucket("highlight-videos")).toBe(true);
    expect(isPrivateMediaBucket("avatars")).toBe(false);
  });

  it("treats legacy long-lived signed URLs as resolvable refs so the token is dropped", () => {
    const legacy =
      "https://x.supabase.co/storage/v1/object/sign/game-covers/user-1/cover.jpg?token=STALE";
    expect(parseStorageMediaUrl(legacy)).toEqual({
      bucket: "game-covers",
      path: "user-1/cover.jpg",
    });
    expect(resolvableMediaRef(legacy)).toEqual({
      bucket: "game-covers",
      path: "user-1/cover.jpg",
    });
  });

  it("passes public bucket URLs and bundled assets through untouched", () => {
    expect(
      resolvableMediaRef("https://x.supabase.co/storage/v1/object/public/avatars/a/b.jpg"),
    ).toBeNull();
    expect(resolvableMediaRef("/assets/basketball.jpg")).toBeNull();
    expect(resolvableMediaRef(null)).toBeNull();
  });

  it("rejects malformed refs instead of guessing a bucket", () => {
    expect(parseMediaRef("storage://")).toBeNull();
    expect(parseMediaRef("storage://game-covers")).toBeNull();
    expect(parseMediaRef("storage://game-covers/")).toBeNull();
  });
});

describe("video upload validation", () => {
  it("judges a clip on size alone, with no container allowlist to disagree with", async () => {
    expect(validateVideoSize({ bytes: 1024 })).toBeNull();

    // Regression guard, and the real point of this test. This module used to
    // export ALLOWED_VIDEO_EXTENSIONS / ALLOWED_VIDEO_MIMES and reject anything
    // absent from them, which turned away .avi/.mkv/.wmv/.flv/.3gp/.mts —
    // exactly the formats convertToPlayableMp4 handles. It also disagreed with
    // the server's own byte sniff over `mpeg`. Re-adding an allowlist here
    // re-creates both faults, so fail loudly if one comes back.
    const mod = await import("@/lib/video-validation");
    for (const banned of [
      "ALLOWED_VIDEO_MIMES",
      "ALLOWED_VIDEO_EXTENSIONS",
      "isAllowedVideoMime",
      "isAllowedVideoExtension",
      "validateVideoMeta",
    ]) {
      expect(Object.keys(mod)).not.toContain(banned);
    }
  });

  it("still rejects empty and oversize uploads", () => {
    expect(validateVideoSize({ bytes: 0 })).toMatch(/empty/i);
    expect(validateVideoSize({ bytes: null })).toMatch(/empty/i);
    expect(validateVideoSize({ bytes: undefined })).toMatch(/empty/i);
    expect(validateVideoSize({ bytes: MAX_VIDEO_BYTES + 1 })).toMatch(/too large/i);
    expect(validateVideoSize({ bytes: MAX_VIDEO_BYTES })).toBeNull();
  });

  it("sniffs the real container from magic bytes", () => {
    const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    expect(sniffVideoContainer(mp4)).toBe("mp4");
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
    expect(sniffVideoContainer(webm)).toBe("webm");
    const html = new Uint8Array([0x3c, 0x21, 0x64, 0x6f, 0x63, 0x74, 0x79, 0x70, 0x65, 0, 0, 0]);
    expect(sniffVideoContainer(html)).toBeNull();
    const quicktime = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
    expect(sniffVideoContainer(quicktime)).toBe("quicktime");
  });

  it("does not recognise an MPEG program stream, which is why it must not gate sources", () => {
    // 00 00 01 BA. This is the exact pair that used to break uploads: `mpeg` sat
    // on the client allowlist while this sniff — the server gate — could never
    // match it, so the upload was accepted and then deleted. Sources are now
    // finalized as `kind: "source"` and skip this check entirely.
    const mpegPs = new Uint8Array([0x00, 0x00, 0x01, 0xba, 0x44, 0, 0x04, 0, 0x04, 0x01, 0, 0x03]);
    expect(sniffVideoContainer(mpegPs)).toBeNull();
    // Accepting it is now the uploader's job, and size is all it checks.
    expect(validateVideoSize({ bytes: 2048 })).toBeNull();
  });
});
