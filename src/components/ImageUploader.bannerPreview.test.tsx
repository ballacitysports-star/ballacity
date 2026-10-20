// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/ImageEditorDialog", () => ({ ImageEditorDialog: () => null }));
vi.mock("@/lib/image-upload", () => ({ uploadDataUrlToBucket: vi.fn() }));
vi.mock("@/components/ResponsiveImage", () => ({
  ResponsiveImage: ({ alt, aspect }: { alt: string; aspect?: number }) => (
    <img alt={alt} data-aspect={aspect} />
  ),
}));

import { ImageUploader } from "./ImageUploader";

afterEach(cleanup);

const cover = "https://cdn.example/cover.jpg";

describe("ImageUploader banner preview", () => {
  it("shows the cover as the profile banner crop when asked", () => {
    render(
      <ImageUploader
        kind="cover"
        bannerPreview
        bucket="team-covers"
        pathPrefix="u-1"
        value={cover}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("On your profile")).toBeTruthy();
    const banner = screen.getByAltText("Profile banner preview");
    // Same 16:5 request as ProfileChannelHeader, so the crop matches.
    expect(banner.getAttribute("data-aspect")).toBe(String(16 / 5));
  });

  it("stays hidden without a cover, and on uploaders that don't ask for it", () => {
    const { rerender } = render(
      <ImageUploader
        kind="cover"
        bannerPreview
        bucket="team-covers"
        pathPrefix="u-1"
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText("On your profile")).toBeNull();
    rerender(
      <ImageUploader
        kind="cover"
        bucket="game-covers"
        pathPrefix="u-1"
        value={cover}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText("On your profile")).toBeNull();
  });
});
