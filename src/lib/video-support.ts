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
    const ascii = await readHeadAscii(file);
    if (RISKY_TAGS.some((t) => ascii.includes(t))) return false;
    // .webm is VP8/VP9 by definition and unsupported on older iOS Safari.
    if (/\.webm$/i.test(file.name)) return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Stricter, conversion-oriented check: only clips we can positively identify as
 * H.264 (`avc1`) inside an MP4/QuickTime container are left alone. Anything we
 * can't prove is universally decodable (HEVC, unknown containers, odd
 * transcodes) gets an automatic H.264 copy at upload time, so no athlete ever
 * has to tap "Fix playback".
 */
export async function needsPlaybackConversion(file: File): Promise<boolean> {
  try {
    if (!(await isWidelyPlayable(file))) return true;
    const ascii = await readHeadAscii(file);
    const isMp4Container = /ftyp(isom|mp4|avc1|M4V|qt  |iso2|mmp4)/.test(ascii) || /\.(mp4|m4v|mov)$/i.test(file.name);
    const hasH264 = ascii.includes("avc1") || ascii.includes("avcC") || ascii.includes("h264");
    return !(isMp4Container && hasH264);
  } catch {
    // Unknown clip: converting is the safe default.
    return true;
  }
}

async function readHeadAscii(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  let ascii = "";
  for (let i = 0; i < head.length; i++) ascii += String.fromCharCode(head[i]);
  return ascii;
}

