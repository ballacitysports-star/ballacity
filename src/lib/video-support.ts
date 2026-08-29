/**
 * Lightweight client-side checks for "will this clip play everywhere?".
 *
 * The most common highlight-reel failure is a screen recording whose video
 * track is VP9 or AV1 but is wrapped in an .mp4 container: Chrome plays it,
 * Safari/iOS shows a dead player. We sniff the container header for those
 * codec tags so the athlete gets a warning at upload time instead of a
 * mystery blank video later.
 */
const RISKY_TAGS = ["vp09", "vp08", "av01"];

export async function isWidelyPlayable(file: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
    let ascii = "";
    for (let i = 0; i < head.length; i++) ascii += String.fromCharCode(head[i]);
    if (RISKY_TAGS.some((t) => ascii.includes(t))) return false;
    // .webm is VP8/VP9 by definition and unsupported on older iOS Safari.
    if (/\.webm$/i.test(file.name)) return false;
    return true;
  } catch {
    return true;
  }
}
