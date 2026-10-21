/**
 * Validation for the optional image on a team post.
 *
 * A post image is either a built-in sport cover saved by name
 * (`preset:basketball`) or a picture the poster uploaded to the public
 * team-covers bucket under their own user-id folder. Anything else, such as an
 * arbitrary external URL or someone else's upload, is refused so a post can't
 * be used to hotlink outside content.
 */
const PRESET_RE = /^preset:[a-z]{3,20}$/;

export type PostImageResult = { ok: true; value: string | null } | { ok: false; message: string };

export function parsePostImage(
  input: string | null | undefined,
  opts: { userId: string; supabaseUrl: string },
): PostImageResult {
  const raw = input?.trim();
  if (!raw) return { ok: true, value: null };
  if (PRESET_RE.test(raw)) return { ok: true, value: raw };

  const base = opts.supabaseUrl.replace(/\/+$/, "");
  const prefix = `${base}/storage/v1/object/public/team-covers/${opts.userId}/`;
  if (raw.length > 1000 || !raw.startsWith(prefix)) {
    return { ok: false, message: "That image can't be used on a post. Upload it again." };
  }
  const file = raw.slice(prefix.length);
  // One file directly in the poster's folder: no sub-paths or traversal.
  if (!file || /[/\\?#]/.test(file) || file.includes("..")) {
    return { ok: false, message: "That image can't be used on a post. Upload it again." };
  }
  return { ok: true, value: raw };
}
