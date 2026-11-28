import { describe, expect, it } from "vitest";
import { tryStripImageMetadata } from "@/lib/image-metadata";

// Hand-built edge cases found in review: a JPEG whose only metadata is a secondary picture after EOI, and an
// extended WEBP whose last chunk is missing its pad byte while an orientation EXIF has to be appended after it.

const bytes = (...parts: (number[] | Uint8Array)[]) =>
  Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const ascii = (s: string) => Array.from(new TextEncoder().encode(s));
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

// SOI, a baseline SOF0 for a 1x1 grey picture, one SOS with a scan byte, EOI. No APP segment at all.
const plainJpeg = () =>
  bytes(
    [0xff, 0xd8],
    [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00],
    [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00],
    [0x12, 0x34],
    [0xff, 0xd9],
  );

// An Exif APP1 holding a GPS-looking string, as a secondary picture would carry.
const app1 = () => {
  const body = [...ascii("Exif\0\0"), ...ascii("MM"), 0x00, 0x2a, ...ascii("GPS-SECRET")];
  return [0xff, 0xe1, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
};

// A big-endian TIFF with one IFD0 entry: Orientation (0x0112) = value.
const orientationTiff = (value: number) => [
  ...ascii("MM"),
  0x00,
  0x2a,
  0x00,
  0x00,
  0x00,
  0x08,
  0x00,
  0x01,
  0x01,
  0x12,
  0x00,
  0x03,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  value,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
];

const chunk = (type: string, data: number[], pad = true) => [
  ...ascii(type),
  ...u32le(data.length),
  ...data,
  ...(pad && data.length & 1 ? [0] : []),
];

/** Walk RIFF chunks the way a conforming reader does: next chunk at 8 + size + (size & 1). */
function walk(webp: Uint8Array): { type: string; size: number }[] {
  const dv = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const end = 8 + dv.getUint32(4, true);
  const out: { type: string; size: number }[] = [];
  let i = 12;
  while (i + 8 <= end) {
    const type = new TextDecoder().decode(webp.subarray(i, i + 4));
    const size = dv.getUint32(i + 4, true);
    out.push({ type, size });
    i += 8 + size + (size & 1);
  }
  expect(i).toBe(end);
  return out;
}

describe("image metadata edge cases", () => {
  it("reports a secondary picture after a JPEG's EOI as removed metadata", () => {
    const input = bytes(plainJpeg(), [0xff, 0xd8], app1(), [0xff, 0xd9]);
    const r = tryStripImageMetadata(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.report.hasOther).toBe(true);
    expect(Array.from(r.bytes)).toEqual(Array.from(plainJpeg()));
  });

  it("pads a WEBP last chunk that lacks its pad byte before appending the orientation EXIF", () => {
    // VP8X with the EXIF flag set, 1x1 canvas.
    const vp8x = chunk("VP8X", [0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const exif = chunk("EXIF", orientationTiff(6));
    // VP8L of odd size 5 with its pad byte missing; the RIFF size counts no pad.
    const vp8l = chunk("VP8L", [0x2f, 0x00, 0x00, 0x00, 0x00], false);
    const body = [...ascii("WEBP"), ...vp8x, ...exif, ...vp8l];
    const input = bytes(ascii("RIFF"), u32le(body.length), body);

    const r = tryStripImageMetadata(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.orientation).toBe(6);
    const chunks = walk(r.bytes);
    expect(chunks.map((c) => c.type)).toEqual(["VP8X", "VP8L", "EXIF"]);
    expect(chunks[1]!.size).toBe(5);
    expect(r.bytes.length % 2).toBe(0);
    expect(new TextDecoder().decode(r.bytes)).not.toContain("GPS-SECRET");
  });
});
