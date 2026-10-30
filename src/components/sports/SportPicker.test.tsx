// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SPORTS, type Sport } from "@/lib/sample-data";
import { SportPicker } from "./SportPicker";

type Entry = { name: Sport; level?: string };

function Harness({
  initial = [] as Entry[],
  confirmRemove = false,
}: {
  initial?: Entry[];
  confirmRemove?: boolean;
}) {
  const [sports, setSports] = useState<Entry[]>(initial);
  return (
    <>
      <SportPicker sports={sports} onChange={setSports} confirmRemoveWithDetails={confirmRemove} />
      <output data-testid="state">{JSON.stringify(sports)}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "[]") as Entry[];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SportPicker", () => {
  it("asks the question and lists every canonical sport once, launch sports first", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "What sports do you play or follow?" })).toBeTruthy();
    const names = screen.getAllByRole("checkbox").map((c) => c.closest("label")?.textContent ?? "");
    expect(names.length).toBe(SPORTS.length);
    expect(names.slice(0, 7).map((n) => n.replace(/incl\. flag/, ""))).toEqual([
      "🏀Basketball",
      "⚾Baseball",
      "⚽Soccer",
      "🏓Pickleball",
      "🏐Volleyball",
      "🥎Softball",
      "🏈Football",
    ]);
    expect(names[7]).toContain("Tennis");
  });

  it("selects several sports and shows the selected state to assistive tech", () => {
    render(<Harness />);
    const basketball = screen.getByRole("checkbox", { name: /Basketball/ }) as HTMLInputElement;
    expect(basketball.checked).toBe(false);
    fireEvent.click(basketball);
    fireEvent.click(screen.getByRole("checkbox", { name: /Tennis/ }));
    expect((screen.getByRole("checkbox", { name: /Basketball/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(state().map((s) => s.name)).toEqual(["Basketball", "Tennis"]);
  });

  it("deselects a sport and leaves other sports' details alone", () => {
    render(<Harness initial={[{ name: "Soccer", level: "Advanced" }, { name: "Tennis" }]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Tennis/ }));
    expect(state()).toEqual([{ name: "Soccer", level: "Advanced" }]);
  });

  it("asks for a primary sport only once two or more are chosen, and reorders", () => {
    render(<Harness initial={[{ name: "Soccer" }]} />);
    expect(screen.queryByText("Which sport are you most interested in right now?")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Pickleball/ }));
    const group = screen.getByRole("group", {
      name: "Which sport are you most interested in right now?",
    });
    const soccer = within(group).getByRole("radio", { name: "Soccer" }) as HTMLInputElement;
    expect(soccer.checked).toBe(true);
    fireEvent.click(within(group).getByRole("radio", { name: "Pickleball" }));
    expect(state().map((s) => s.name)).toEqual(["Pickleball", "Soccer"]);
  });

  it("works with no selection at all (skipping stays valid)", () => {
    render(<Harness />);
    expect(state()).toEqual([]);
  });

  describe("confirmRemoveWithDetails (Edit profile)", () => {
    const initial: Entry[] = [{ name: "Soccer", level: "Advanced" }, { name: "Tennis" }];

    it("keeps the sport when the member declines to lose its level", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(<Harness initial={initial} confirmRemove />);
      fireEvent.click(screen.getByRole("checkbox", { name: /Soccer/ }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(state().map((s) => s.name)).toEqual(["Soccer", "Tennis"]);
    });

    it("removes it when confirmed, and never asks for a sport with no details", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<Harness initial={initial} confirmRemove />);
      fireEvent.click(screen.getByRole("checkbox", { name: /Tennis/ }));
      expect(confirm).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("checkbox", { name: /Soccer/ }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(state()).toEqual([]);
    });

    it("does not ask in onboarding, where the prop is off", () => {
      const confirm = vi.spyOn(window, "confirm");
      render(<Harness initial={initial} />);
      fireEvent.click(screen.getByRole("checkbox", { name: /Soccer/ }));
      expect(confirm).not.toHaveBeenCalled();
      expect(state().map((s) => s.name)).toEqual(["Tennis"]);
    });
  });
});
