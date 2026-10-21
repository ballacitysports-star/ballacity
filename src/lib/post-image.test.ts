import { describe, expect, it } from "vitest";
import { parsePostImage } from "./post-image";

const opts = { userId: "user-1", supabaseUrl: "https://abc.supabase.co/" };
const own = "https://abc.supabase.co/storage/v1/object/public/team-covers/user-1/photo.jpg";

describe("parsePostImage", () => {
  it("treats a missing image as no image", () => {
    expect(parsePostImage(undefined, opts)).toEqual({ ok: true, value: null });
    expect(parsePostImage(null, opts)).toEqual({ ok: true, value: null });
    expect(parsePostImage("  ", opts)).toEqual({ ok: true, value: null });
  });

  it("accepts a built-in cover saved by name", () => {
    expect(parsePostImage("preset:basketball", opts)).toEqual({
      ok: true,
      value: "preset:basketball",
    });
  });

  it("accepts the poster's own upload", () => {
    expect(parsePostImage(own, opts)).toEqual({ ok: true, value: own });
  });

  it("refuses external URLs, other users' uploads and other buckets", () => {
    for (const bad of [
      "https://evil.example/pixel.png",
      "https://abc.supabase.co/storage/v1/object/public/team-covers/user-2/photo.jpg",
      "https://abc.supabase.co/storage/v1/object/public/avatars/user-1/photo.jpg",
      "https://other.supabase.co/storage/v1/object/public/team-covers/user-1/photo.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
    ]) {
      expect(parsePostImage(bad, opts).ok).toBe(false);
    }
  });

  it("refuses sub-paths, query strings and traversal inside the poster's folder", () => {
    const base = "https://abc.supabase.co/storage/v1/object/public/team-covers/user-1/";
    for (const bad of [
      `${base}a/b.jpg`,
      `${base}a.jpg?x=1`,
      `${base}..%2F`,
      `${base}`,
      `${base}a..b/`,
    ]) {
      expect(parsePostImage(bad, opts).ok).toBe(false);
    }
  });

  it("refuses malformed preset names", () => {
    for (const bad of [
      "preset:",
      "preset:Basketball",
      "preset:a",
      "preset:basket ball",
      "preset:../x",
    ]) {
      expect(parsePostImage(bad, opts).ok).toBe(false);
    }
  });
});
