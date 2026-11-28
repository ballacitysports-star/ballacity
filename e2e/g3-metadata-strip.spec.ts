import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HAS_DB, SUPABASE_URL, openAs, signInFixture } from "./helpers/fixture-session";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * G3 against real Storage: a picture uploaded as sent (the raw path chat pictures under 300 KB and game covers take)
 * is stripped by `finalizeImageUpload`, which writes the clean bytes back over the stored object. Unit tests use a fake
 * storage, so only this spec shows that the write-back works on the real bucket, keeps the content type, and leaves
 * no metadata behind.
 *
 * The fixture is the orientation-6 JPEG with a JPEG comment segment holding a marker added in front of its frame. A
 * comment is personal metadata the stripper drops, so the stored object must change.
 */

const MARKER = "g3-e2e-marker-do-not-keep";

/** o6.jpg with a COM segment holding MARKER inserted right after SOI. */
function fixtureWithComment(): Uint8Array {
  const jpeg = new Uint8Array(readFileSync(join(__dirname, "fixtures", "exif", "o6.jpg")));
  const text = new TextEncoder().encode(MARKER);
  const len = text.length + 2;
  const com = Uint8Array.from([0xff, 0xfe, (len >> 8) & 0xff, len & 0xff, ...text]);
  const out = new Uint8Array(jpeg.length + com.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(com, 2);
  out.set(jpeg.subarray(2), 2 + com.length);
  return out;
}

test.describe("G3 metadata stripping on real Storage", () => {
  test.skip(!HAS_DB, "needs the E2E Supabase project");

  test("finalizeImageUpload overwrites a raw upload with the stripped bytes", async ({
    browser,
  }) => {
    const player = await signInFixture("player");
    const path = `${player.id}/g3-e2e-${Date.now()}.jpg`;
    const original = fixtureWithComment();
    expect(new TextDecoder("latin1").decode(original)).toContain(MARKER);

    const { error: upErr } = await player.db.storage
      .from("avatars")
      .upload(path, original, { contentType: "image/jpeg", upsert: false });
    expect(upErr, upErr?.message).toBeNull();

    const { context, page } = await openAs(browser, player);
    try {
      // Called straight from the module, outside the app's start instance, the call does not go through the global
      // middleware that attaches the session's bearer token, so the spec passes the fixture's token itself.
      const result = await page.evaluate(
        async ({ p, token }) => {
          // @ts-expect-error - dev-server module path
          const mod = await import("/src/lib/image-uploads.functions.ts");
          try {
            return {
              ok: true,
              value: await mod.finalizeImageUpload({
                data: { bucket: "avatars", path: p },
                headers: { Authorization: `Bearer ${token}` },
              }),
            };
          } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
        },
        { p: path, token: player.session.access_token },
      );
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true });

      const { data: blob, error: dlErr } = await player.db.storage.from("avatars").download(path);
      expect(dlErr, dlErr?.message).toBeNull();
      const stored = new Uint8Array(await blob!.arrayBuffer());
      expect(stored[0]).toBe(0xff);
      expect(stored[1]).toBe(0xd8);
      expect(stored.length).toBeLessThan(original.length);
      expect(new TextDecoder("latin1").decode(stored)).not.toContain(MARKER);

      // The public object is served as a JPEG, not the text/plain Storage gives an untyped body.
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}?t=${Date.now()}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/^image\/jpeg/);
      expect(
        new TextDecoder("latin1").decode(new Uint8Array(await res.arrayBuffer())),
      ).not.toContain(MARKER);
    } finally {
      await context.close();
      await player.db.storage.from("avatars").remove([path]);
    }
  });
});
