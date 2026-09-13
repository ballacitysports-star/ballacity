import { describe, expect, it } from "vitest";
import {
  buildMediaRef,
  isMediaRef,
  isPrivateMediaBucket,
  parseMediaRef,
  parseStorageMediaUrl,
  resolvableMediaRef,
} from "@/lib/media-refs";
import { sniffVideoContainer, validateVideoMeta, MAX_VIDEO_BYTES } from "@/lib/video-validation";

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
  it("accepts common phone clips", () => {
    expect(
      validateVideoMeta({ name: "clip.MOV", mime: "video/quicktime", bytes: 1024 }),
    ).toBeNull();
    expect(validateVideoMeta({ name: "clip.mp4", mime: "", bytes: 1024 })).toBeNull();
  });

  it("rejects disguised files, empty files and oversize uploads", () => {
    expect(validateVideoMeta({ name: "payload.exe", mime: "video/mp4", bytes: 10 })).toMatch(
      /only/i,
    );
    expect(validateVideoMeta({ name: "clip.mp4", mime: "text/html", bytes: 10 })).toMatch(/only/i);
    expect(validateVideoMeta({ name: "clip.mp4", mime: "video/mp4", bytes: 0 })).toMatch(/empty/i);
    expect(
      validateVideoMeta({ name: "clip.mp4", mime: "video/mp4", bytes: MAX_VIDEO_BYTES + 1 }),
    ).toMatch(/too large/i);
  });

  it("sniffs the real container from magic bytes", () => {
    const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    expect(sniffVideoContainer(mp4)).toBe("mp4");
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
    expect(sniffVideoContainer(webm)).toBe("webm");
    const html = new Uint8Array([0x3c, 0x21, 0x64, 0x6f, 0x63, 0x74, 0x79, 0x70, 0x65, 0, 0, 0]);
    expect(sniffVideoContainer(html)).toBeNull();
  });
});
