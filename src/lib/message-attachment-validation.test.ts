import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentProblem,
  classifyAttachment,
  parseAttachmentPath,
} from "./message-attachment-validation";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(32).fill(0)]);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);
const MP4 = new Uint8Array([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
]);
const MOV = new Uint8Array([
  0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0,
]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00);

describe("classifyAttachment", () => {
  it("identifies pictures, videos and PDFs from their bytes", () => {
    expect(classifyAttachment(PNG)).toEqual({ kind: "image", mime: "image/png" });
    expect(classifyAttachment(JPEG)).toEqual({ kind: "image", mime: "image/jpeg" });
    expect(classifyAttachment(MP4)).toEqual({ kind: "video", mime: "video/mp4" });
    expect(classifyAttachment(MOV)).toEqual({ kind: "video", mime: "video/quicktime" });
    expect(classifyAttachment(PDF)).toEqual({ kind: "pdf", mime: "application/pdf" });
  });

  it("refuses anything else, whatever it is called", () => {
    expect(classifyAttachment(HTML)).toBeNull();
    expect(classifyAttachment(EXE)).toBeNull();
    expect(classifyAttachment(new Uint8Array())).toBeNull();
  });
});

describe("attachmentProblem", () => {
  it("passes an allowed file and refuses a disguised one", () => {
    expect(attachmentProblem(PNG)).toBeNull();
    expect(attachmentProblem(HTML)).toMatch(/not allowed/);
  });

  it("refuses an oversized file even if its type is fine", () => {
    expect(attachmentProblem(PNG, MAX_ATTACHMENT_BYTES + 1)).toMatch(/too large/);
  });
});

describe("parseAttachmentPath", () => {
  const conv = "6f1c2d3e-0000-4000-8000-123456789abc";
  const me = "7a1c2d3e-0000-4000-8000-123456789abd";
  it("accepts the shape the uploader writes", () => {
    expect(parseAttachmentPath(`${conv}/${me}/1700-photo.png`)).toEqual({
      conversationId: conv,
      senderId: me,
    });
  });
  it("refuses other shapes, including path tricks", () => {
    for (const p of [
      `${conv}/${me}`,
      `${conv}/${me}/a/b.png`,
      `x/${me}/a.png`,
      `${conv}/../${me}/a.png`,
      "",
    ]) {
      expect(parseAttachmentPath(p)).toBeNull();
    }
  });
});
