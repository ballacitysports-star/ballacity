// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SportChips } from "./SportChips";
import { SPORTS } from "@/lib/sample-data";
import { basketballFirstPriority } from "@/lib/sport-hubs";

afterEach(cleanup);

describe("SportChips ordering (Find Players)", () => {
  it("shows Basketball first, then the member's sports, then the rest in canonical order", () => {
    render(<SportChips multi selected={[]} prioritize={basketballFirstPriority(["Tennis"])} />);
    const buttons = within(screen.getByRole("group", { name: "Filter by sport" })).getAllByRole(
      "button",
    );
    expect(buttons[0].textContent).toBe("All sports");
    const names = buttons.slice(1).map((b) => b.textContent ?? "");
    const expectedRest = SPORTS.map((s) => s.name).filter(
      (n) => n !== "Basketball" && n !== "Tennis",
    );
    expect(names.map((n) => SPORTS.find((s) => n.endsWith(s.name))?.name)).toEqual([
      "Basketball",
      "Tennis",
      ...expectedRest,
    ]);
  });

  it("keeps every sport selectable and passes the tapped sport through in multi mode", () => {
    const onSelect = vi.fn();
    render(
      <SportChips
        multi
        selected={["Soccer"]}
        onSelect={onSelect}
        prioritize={basketballFirstPriority([])}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(SPORTS.length + 1);
    expect(screen.getByRole("button", { name: /Soccer/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: /Basketball/ }));
    expect(onSelect).toHaveBeenCalledWith("Basketball");
  });
});
