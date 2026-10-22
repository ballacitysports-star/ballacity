// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SampleImage } from "./SampleImage";
import { HERO_IMAGE, imageFor } from "@/lib/sample-data";

afterEach(cleanup);

describe("SampleImage", () => {
  it("shows the picture for the sport, whatever the case", () => {
    const { container } = render(<SampleImage sport="soccer" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(imageFor("Soccer"));
  });

  it("falls back to the default picture for an unknown or missing sport", () => {
    const a = render(<SampleImage sport="Curling" />);
    expect(a.container.querySelector("img")?.getAttribute("src")).toBe(HERO_IMAGE);
    a.unmount();
    const b = render(<SampleImage sport={null} />);
    expect(b.container.querySelector("img")?.getAttribute("src")).toBe(HERO_IMAGE);
  });

  it("labels a banner as a sample, and leaves a thumbnail unlabelled", () => {
    const banner = render(<SampleImage sport="Tennis" caption />);
    expect(screen.getByText("Sample image")).toBeTruthy();
    banner.unmount();
    render(<SampleImage sport="Tennis" />);
    expect(screen.queryByText("Sample image")).toBeNull();
  });

  it("is decoration: no alt text for a screen reader to read as the listing's photo", () => {
    const { container } = render(<SampleImage sport="Tennis" caption />);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });
});
