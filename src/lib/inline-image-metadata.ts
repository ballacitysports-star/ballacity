import { tryStripImageMetadata } from "@/lib/image-metadata";
import { sniffImageMime } from "@/lib/image-validation";

/**
 * G3 for pictures stored inline in a row as a `data:` URL rather than in Storage: today the team and coach staff
 * avatars, which the edit screens read with FileReader and send to createTeam/updateTeam inside the `staff` list.
 * Pure (atob/btoa only), so the server functions and the browser use the same rules.
 */

// Any declared type, or none: the type is read from the bytes, because a browser shows a data URL's picture by its
// bytes whatever it is labelled (an empty File type gives data:application/octet-stream, for example).
const BASE64_DATA_URL = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]*)$/i;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // In slices, because spreading a whole photo into one call overflows the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * The same picture without its metadata, or null when it is not a base64 JPEG, PNG or WEBP we can parse (the caller
 * then must not store it). The declared type is ignored; the type in the result is the one the bytes really have.
 */
export function stripImageDataUrl(dataUrl: string): string | null {
  const m = BASE64_DATA_URL.exec(dataUrl);
  if (!m) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(m[1]!.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const mime = sniffImageMime(bytes);
  if (!mime) return null;
  const result = tryStripImageMetadata(bytes);
  if (!result.ok) return null;
  return `data:${mime};base64,${bytesToBase64(result.bytes)}`;
}

/** The edit screens' placeholder for a staff member without a picture. */
export function staffInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OR";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type StaffMember = { name: string; role: string; avatar: string };

/**
 * Staff avatars as they may be stored. The edit screens and the team page show every avatar that starts with
 * `data:` as a picture, so every `data:` avatar is cleaned here, whatever type it declares: a JPEG, PNG or WEBP comes
 * back stripped and labelled with its real type; anything else (HEIC, GIF, SVG, a broken file, a data URL that is
 * not base64) is replaced by the member's initials, so the photo is dropped rather than stored with its metadata,
 * and a team that already holds such a picture can still be saved. SVG is dropped too, because it can carry a
 * raster with its own metadata inside an <image> element, and the app never makes SVG staff photos. Initials and
 * links are left as they are.
 */
export function cleanStaffAvatars<T extends StaffMember>(staff: T[]): T[] {
  return staff.map((member) => {
    const avatar = member.avatar;
    if (!/^data:/i.test(avatar)) return member;
    const clean = stripImageDataUrl(avatar);
    return { ...member, avatar: clean ?? staffInitials(member.name) };
  });
}
