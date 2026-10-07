// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/places.functions", () => ({
  autocompletePlaces: async () => ({ suggestions: [] }),
  getPlaceDetails: async () => ({}),
}));
vi.mock("@/components/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));
vi.mock("@/components/VenueMapPreview", () => ({
  VenueMapPreview: () => <div data-testid="map" />,
}));
vi.mock("@/components/ImageUploader", () => ({ ImageUploader: () => null }));
vi.mock("@/components/org/PhotoGalleryEditor", () => ({ PhotoGalleryEditor: () => null }));

import { OrgForm, emptyOrgForm, type OrgFormValue } from "./OrgForm";

afterEach(cleanup);

function Harness({ onChange }: { onChange?: (v: OrgFormValue) => void }) {
  const [value, setValue] = useState<OrgFormValue>({ ...emptyOrgForm(), timezone: "UTC" });
  return (
    <OrgForm
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      userId="u1"
      submitting={false}
      onSubmit={() => {}}
      submitLabel="Create gym"
    />
  );
}

describe("OrgForm facility onboarding", () => {
  it("offers grouped court/equipment amenities and toggles them", () => {
    let latest: OrgFormValue | null = null;
    render(<Harness onChange={(v) => (latest = v)} />);
    for (const label of [
      "Hardwood courts",
      "Outdoor cages",
      "Lighting",
      "Ball rentals",
      "Scoreboards",
    ]) {
      expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getAllByRole("button", { name: "Lighting" })[0]);
    expect(latest!.amenities).toContain("Lighting");
  });

  it("steps the court count and shows it in the live preview", () => {
    let latest: OrgFormValue | null = null;
    render(<Harness onChange={(v) => (latest = v)} />);
    fireEvent.click(screen.getByRole("button", { name: "More courts" }));
    fireEvent.click(screen.getByRole("button", { name: "More courts" }));
    expect(latest!.amenities).toContain("2 courts");
    expect(screen.getAllByText("2 courts").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Fewer courts" }));
    expect(latest!.amenities).toContain("1 court");
  });

  it("suggests a handle from the name until the user edits it", () => {
    let latest: OrgFormValue | null = null;
    render(<Harness onChange={(v) => (latest = v)} />);
    const name = screen.getByPlaceholderText("Search a gym or type a name");
    fireEvent.change(name, { target: { value: "Peak Gym & Courts" } });
    expect(latest!.handle).toBe("peak-gym-courts");
    fireEvent.change(screen.getByPlaceholderText("peakgym"), { target: { value: "mine" } });
    fireEvent.change(name, { target: { value: "Peak Gym North" } });
    expect(latest!.handle).toBe("mine");
  });

  it("previews open/closed status live from the weekly hours", () => {
    render(<Harness />);
    expect(screen.getAllByText("Hours not set").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Open 24/7" }));
    expect(screen.getAllByText("Open now").length).toBeGreaterThan(0);
    expect(screen.getByText("Weekly hours")).toBeTruthy();
  });
});
