// @vitest-environment jsdom
import { useState } from "react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgeRequirementFields } from "./AgeRequirementFields";

afterEach(cleanup);

function Harness({
  initial = { minAge: null, maxAge: null },
  spy,
}: {
  initial?: { minAge: number | null; maxAge: number | null };
  spy?: (n: { minAge: number | null; maxAge: number | null }) => void;
}) {
  const [age, setAge] = useState(initial);
  return (
    <AgeRequirementFields
      minAge={age.minAge}
      maxAge={age.maxAge}
      onChange={(n) => {
        spy?.(n);
        setAge(n);
      }}
    />
  );
}

const note = () => screen.getByTestId("age-public-discovery-note");

describe("AgeRequirementFields public discovery note", () => {
  it("explains that an unspecified range is not in public discovery, without changing it", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    expect(note().dataset.kind).toBe("unset");
    expect(note().textContent).toMatch(/You can still create this game/);
    expect(note().textContent).toMatch(/won't appear in public discovery/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("offers a review action that focuses the presets and does not change the selection", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "Review age range" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Any age" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("is a polite live region so a screen reader hears the change", () => {
    render(<Harness />);
    expect(note().getAttribute("role")).toBe("status");
  });

  it("updates as the host picks a range", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "21+" }));
    expect(spy).toHaveBeenLastCalledWith({ minAge: 21, maxAge: null });
    expect(note().dataset.kind).toBe("eligible");
    expect(note().textContent).toMatch(/as long as it is public/);
    expect(screen.queryByRole("button", { name: "Review age range" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "16+" }));
    expect(note().dataset.kind).toBe("includes_minors");
    expect(note().textContent).toMatch(/includes people under 18/);

    fireEvent.click(screen.getByRole("button", { name: "Any age" }));
    expect(note().dataset.kind).toBe("unset");
  });

  it("shows the no-minimum and mixed-age messages for custom ranges", () => {
    const { rerender } = render(
      <AgeRequirementFields minAge={null} maxAge={40} onChange={() => {}} />,
    );
    expect(note().dataset.kind).toBe("no_minimum");
    rerender(<AgeRequirementFields minAge={16} maxAge={30} onChange={() => {}} />);
    expect(note().dataset.kind).toBe("includes_minors");
  });

  it("makes no public-eligibility claim for an inverted range", () => {
    render(<AgeRequirementFields minAge={40} maxAge={30} onChange={() => {}} />);
    expect(note().dataset.kind).toBe("invalid");
    expect(note().textContent).not.toMatch(/discovery/);
  });

  it("keeps the existing preset payloads", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    for (const [name, payload] of [
      ["13+", { minAge: 13, maxAge: null }],
      ["18+", { minAge: 18, maxAge: null }],
      ["Any age", { minAge: null, maxAge: null }],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(spy).toHaveBeenLastCalledWith(payload);
    }
  });
});

describe("create and edit forms", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const create = read("src/routes/_tabs.create.tsx");
  const edit = read("src/routes/games.$gameId.index.tsx");

  it("both use the one shared component, so they carry the same note exactly once", () => {
    expect(create.match(/<AgeRequirementFields/g)).toHaveLength(1);
    expect(edit.match(/<AgeRequirementFields/g)).toHaveLength(1);
  });

  it("does not default a new game's age range", () => {
    expect(create).toMatch(/const \[minAge, setMinAge\] = useState<number \| null>\(null\)/);
    expect(create).toMatch(/const \[maxAge, setMaxAge\] = useState<number \| null>\(null\)/);
  });
});
