// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GameScheduleBuilder } from "@/components/create/GameScheduleBuilder";
import type { ScheduleEntry } from "@/lib/game-schedule";

function Harness() {
  const [v, setV] = useState<ScheduleEntry[]>([]);
  return <GameScheduleBuilder value={v} onChange={setV} />;
}

describe("GameScheduleBuilder", () => {
  it("selects days and shows per-day start and end times", () => {
    render(<Harness />);
    const cells = screen
      .getAllByRole("button")
      .filter((b) => /^\d+$/.test(b.textContent ?? "") && !(b as HTMLButtonElement).disabled);
    expect(cells.length).toBeGreaterThan(0);
    fireEvent.click(cells[cells.length - 1]!);
    // One start + one end input per selected day.
    expect(document.querySelectorAll('input[type="time"]').length).toBe(2);
    if (cells.length > 1) {
      fireEvent.click(cells[cells.length - 2]!);
      expect(document.querySelectorAll('input[type="time"]').length).toBe(4);
    }
    expect(screen.getByText(/Creates \d+ game/)).toBeTruthy();
  });

  it("all day hides that day's clock inputs", () => {
    const { container, getAllByRole } = render(<Harness />);
    const cells = getAllByRole("button").filter(
      (b) => /^\d+$/.test(b.textContent ?? "") && !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(cells[cells.length - 1]!);
    expect(container.querySelectorAll('input[type="time"]').length).toBe(2);
    fireEvent.click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(container.querySelectorAll('input[type="time"]').length).toBe(0);
  });
});
