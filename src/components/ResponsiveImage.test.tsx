// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

// Fake timers + a `setTimeout`-driven state update (the retry backoff) need an
// explicit `act` boundary, or React defers the DOM update past this helper.
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

// This project registers no global test setup, so Testing Library's automatic
// cleanup is not installed — without this, each render stacks up in the same
// document and later queries match elements from earlier cases.
afterEach(cleanup);

vi.mock("@/hooks/use-media-url", () => ({
  useMediaUrl: (value: string | null | undefined) => value ?? null,
}));

vi.mock("@/lib/blocked-images", () => ({
  useBlockedImage: () => false,
}));

const { ResponsiveImage, ResponsiveAvatar } = await import("@/components/ResponsiveImage");

const SRC = "https://x.supabase.co/storage/v1/object/public/avatars/a.jpg";

/**
 * The bug this guards: a failed image used to leave a permanently broken
 * `<img>` with no way back to the caller's fallback content. These assert the
 * retry-then-give-up sequence, and that giving up is observable (`onLoadError`,
 * and the element unmounting) so a caller can swap to initials/a letter/an icon.
 */
describe("ResponsiveImage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the image and never calls onLoadError when nothing fails", () => {
    const onLoadError = vi.fn();
    render(<ResponsiveImage src={SRC} alt="Avatar" onLoadError={onLoadError} />);
    expect(screen.getByAltText("Avatar")).toBeTruthy();
    expect(onLoadError).not.toHaveBeenCalled();
  });

  it("retries with a cache-busting query param on each failure, dropping srcSet so the bust isn't overridden", () => {
    render(<ResponsiveImage src={SRC} alt="Avatar" />);
    let img = screen.getByAltText("Avatar") as HTMLImageElement;
    expect(img.src).not.toContain("retry=");
    expect(img.srcset).not.toBe("");

    fireEvent.error(img);
    advance(400);
    img = screen.getByAltText("Avatar") as HTMLImageElement;
    expect(img.src).toContain("retry=1");
    expect(img.srcset).toBe("");

    fireEvent.error(img);
    advance(800);
    img = screen.getByAltText("Avatar") as HTMLImageElement;
    expect(img.src).toContain("retry=2");
  });

  it("gives up after exhausting retries: unmounts the image and fires onLoadError exactly once", () => {
    const onLoadError = vi.fn();
    render(<ResponsiveImage src={SRC} alt="Avatar" onLoadError={onLoadError} />);
    let img = screen.getByAltText("Avatar") as HTMLImageElement;

    fireEvent.error(img);
    advance(400);
    img = screen.getByAltText("Avatar") as HTMLImageElement;

    fireEvent.error(img);
    advance(800);
    img = screen.getByAltText("Avatar") as HTMLImageElement;

    fireEvent.error(img);
    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText("Avatar")).toBeNull();
  });

  it("resets and retries fresh when the src prop changes, so a newly-saved photo isn't stuck behind an old failure", () => {
    const onLoadError = vi.fn();
    const { rerender } = render(
      <ResponsiveImage src={SRC} alt="Avatar" onLoadError={onLoadError} />,
    );
    let img = screen.getByAltText("Avatar") as HTMLImageElement;
    fireEvent.error(img);
    advance(400);

    const NEXT_SRC = "https://x.supabase.co/storage/v1/object/public/avatars/b.jpg";
    rerender(<ResponsiveImage src={NEXT_SRC} alt="Avatar" onLoadError={onLoadError} />);
    img = screen.getByAltText("Avatar") as HTMLImageElement;
    expect(img.src).not.toContain("retry=");
    expect(img.src).toContain("/avatars/b.jpg");
    expect(onLoadError).not.toHaveBeenCalled();
  });

  it("renders nothing for a null src instead of an empty broken image", () => {
    render(<ResponsiveImage src={null} alt="Avatar" />);
    expect(screen.queryByAltText("Avatar")).toBeNull();
  });
});

describe("ResponsiveAvatar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests a square, cropped variant and forwards onLoadError to the caller", () => {
    const onLoadError = vi.fn();
    render(<ResponsiveAvatar src={SRC} size={64} alt="Avatar" onLoadError={onLoadError} />);
    const img = screen.getByAltText("Avatar") as HTMLImageElement;
    expect(img.src).toContain("resize=cover");

    fireEvent.error(img);
    advance(400);
    fireEvent.error(screen.getByAltText("Avatar"));
    advance(800);
    fireEvent.error(screen.getByAltText("Avatar"));

    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText("Avatar")).toBeNull();
  });
});
