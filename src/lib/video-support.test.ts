import { describe, expect, it } from "vitest";
import { needsPlaybackConversion } from "./video-support";

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

/** A phone-camera clip: the media first, its movie header (and codec) after it. */
function phoneClip(codec: string, name: string): File {
  const hdlr = box("hdlr", concat(new Uint8Array(8), text("vide"), new Uint8Array(12)));
  const stsd = box(
    "stsd",
    concat(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), box(codec, new Uint8Array(78))),
  );
  const trak = box("trak", box("mdia", concat(hdlr, box("minf", box("stbl", stsd)))));
  const bytes = concat(
    box("ftyp", text("qt  \0\0\0\0qt  ")),
    box("mdat", new Uint8Array(700_000)),
    box("moov", trak),
  );
  return new File([bytes.buffer as ArrayBuffer], name);
}

describe("needsPlaybackConversion", () => {
  it("leaves an H.264 phone clip alone even though its header is past the first 512 KB", async () => {
    expect(await needsPlaybackConversion(phoneClip("avc1", "IMG_0001.MOV"))).toBe(false);
  });

  it("still converts HEVC and anything it cannot read", async () => {
    expect(await needsPlaybackConversion(phoneClip("hvc1", "IMG_0002.MOV"))).toBe(true);
    expect(await needsPlaybackConversion(new File(["RIFF....AVI "], "clip.avi"))).toBe(true);
    expect(await needsPlaybackConversion(phoneClip("avc1", "screen.webm"))).toBe(true);
  });
});
