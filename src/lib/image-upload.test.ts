import { beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.fn();
const fromSpy = vi.fn();
const getUser = vi.fn();
const promote = vi.fn();
const finalize = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => getUser() },
    storage: {
      from: (bucket: string) => {
        fromSpy(bucket);
        return {
          upload: (...a: unknown[]) => upload(bucket, ...a),
          getPublicUrl: () => ({ data: { publicUrl: "https://x/p" } }),
        };
      },
    },
  },
}));
vi.mock("@/lib/image-uploads.functions", () => ({
  promoteStagedImageUpload: (a: unknown) => promote(a),
  finalizeImageUpload: (a: unknown) => finalize(a),
}));
vi.mock("@/lib/blocked-images", () => ({ refreshBlockedImages: vi.fn() }));
vi.mock("@/lib/image-variants", () => ({ warmImageVariants: vi.fn() }));

// a 100x80 JPEG data URL (header only is enough for the client-side validation)
function dataUrl() {
  const b = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 80, 0, 100, 1, 1, 0x11, 0, 0xff, 0xda, 0, 6, 1, 1, 0, 0,
    63, 0, 1, 2, 3, 0xff, 0xd9,
  ]);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return `data:image/jpeg;base64,${btoa(s)}`;
}

import { uploadDataUrlToBucket } from "./image-upload";

describe("uploadDataUrlToBucket (staging only)", () => {
  beforeEach(() => {
    upload.mockReset();
    fromSpy.mockReset();
    promote.mockReset();
    finalize.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("stages first and publishes through the server; never writes the destination from the browser", async () => {
    upload.mockResolvedValue({ error: null });
    promote.mockResolvedValue({ quarantined: false });
    const url = await uploadDataUrlToBucket("avatars", "u1", dataUrl());
    expect(url).toBe("https://x/p");
    const uploaded = upload.mock.calls.map((c) => c[0]);
    expect(uploaded).toEqual(["image-staging"]);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("does NOT fall back to a public upload when the staging bucket is missing", async () => {
    upload.mockResolvedValue({ error: { message: "Bucket not found" } });
    await expect(uploadDataUrlToBucket("avatars", "u1", dataUrl())).rejects.toThrow(
      /temporarily unavailable/,
    );
    expect(upload.mock.calls.every((c) => c[0] === "image-staging")).toBe(true);
    expect(promote).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("does NOT fall back on any other staging error", async () => {
    upload.mockResolvedValue({ error: { message: "network down" } });
    await expect(uploadDataUrlToBucket("covers", "u1", dataUrl())).rejects.toThrow(/network down/);
    expect(upload.mock.calls.every((c) => c[0] === "image-staging")).toBe(true);
  });

  it("refuses a folder that is not the caller's own", async () => {
    await expect(uploadDataUrlToBucket("org-covers", "some-org-id", dataUrl())).rejects.toThrow(
      /own folder/,
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(uploadDataUrlToBucket("avatars", "u1", dataUrl())).rejects.toThrow(/Sign in/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("reports a held scan as a retryable problem and publishes nothing", async () => {
    upload.mockResolvedValue({ error: null });
    promote.mockResolvedValue({ held: true, quarantined: false });
    await expect(uploadDataUrlToBucket("avatars", "u1", dataUrl())).rejects.toThrow(
      /couldn't check/i,
    );
  });

  it("reports a quarantined image and publishes nothing", async () => {
    upload.mockResolvedValue({ error: null });
    promote.mockResolvedValue({ quarantined: true });
    await expect(uploadDataUrlToBucket("avatars", "u1", dataUrl())).rejects.toThrow(/flagged/);
  });

  it("surfaces a server refusal (authorization or validation) instead of publishing", async () => {
    upload.mockResolvedValue({ error: null });
    promote.mockRejectedValue(new Error("You can only finalize your own uploads"));
    await expect(uploadDataUrlToBucket("avatars", "u1", dataUrl())).rejects.toThrow(
      /your own uploads/,
    );
  });
});
