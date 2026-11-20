import { describe, expect, it } from "vitest";
import {
  ANIMATED_IMAGE_REFUSAL,
  IMAGE_FLAGGED_MESSAGE,
  UNREADABLE_IMAGE_REFUSAL,
  imageUploadErrorMessage,
  isImageUploadRefusal,
} from "@/lib/image-upload-errors";
import { validateImageMeta } from "@/lib/image-validation";

const FALLBACK = "Couldn't upload that photo. Please try again.";

describe("imageUploadErrorMessage", () => {
  const own = [
    IMAGE_FLAGGED_MESSAGE,
    ANIMATED_IMAGE_REFUSAL,
    UNREADABLE_IMAGE_REFUSAL,
    validateImageMeta({ mime: "image/heic", bytes: 10 }),
    validateImageMeta({ mime: "image/png", bytes: 0 }),
    validateImageMeta({ mime: "image/jpeg", bytes: 10 * 1024 * 1024 }),
    validateImageMeta({ mime: "image/png", bytes: 10, dimensions: { width: 20, height: 20 } }),
    validateImageMeta({ mime: "image/png", bytes: 10, dimensions: { width: 7000, height: 20 } }),
    validateImageMeta({ mime: "image/png", bytes: 10, dimensions: { width: 5999, height: 5999 } }),
  ];

  it.each(own)("shows our own refusal %s as it is", (sentence) => {
    expect(sentence).toBeTruthy();
    expect(isImageUploadRefusal(sentence)).toBe(true);
    expect(imageUploadErrorMessage(new Error(sentence!), FALLBACK)).toBe(sentence);
  });

  it("never shows a storage or unknown error raw", () => {
    expect(
      imageUploadErrorMessage(new Error("new row violates row-level security policy"), FALLBACK),
    ).not.toMatch(/row-level/);
    expect(imageUploadErrorMessage(new Error("The resource already exists"), FALLBACK)).toBe(
      FALLBACK,
    );
    expect(imageUploadErrorMessage(new Error("Unsupported bucket"), FALLBACK)).toBe(FALLBACK);
  });
});
