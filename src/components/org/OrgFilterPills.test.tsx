// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DirectoryFilterId } from "@/lib/org-directory-filters";
import { OrgFilterPills } from "./OrgFilterPills";

afterEach(cleanup);

function Harness() {
  const [sel, setSel] = useState<ReadonlySet<DirectoryFilterId>>(new Set());
  return (
    <OrgFilterPills
      selected={sel}
      onToggle={(id) =>
        setSel((cur) => {
          const next = new Set(cur);
          if (!next.delete(id)) next.add(id);
          return next;
        })
      }
      onClear={() => setSel(new Set())}
    />
  );
}

const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("OrgFilterPills", () => {
  it("renders All plus the four pills in a scrollable group, with All on by default", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: "Filter facilities" });
    expect(group.className).toContain("overflow-x-auto");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All",
      "Open now",
      "Court rentals",
      "Indoor courts",
      "Outdoor courts",
    ]);
    expect(pressed("All")).toBe("true");
  });

  it("toggles pills on and off in one tap, and All clears them", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open now" }));
    fireEvent.click(screen.getByRole("button", { name: "Indoor courts" }));
    expect(pressed("Open now")).toBe("true");
    expect(pressed("Indoor courts")).toBe("true");
    expect(pressed("All")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Open now" }));
    expect(pressed("Open now")).toBe("false");
    expect(pressed("Indoor courts")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(pressed("Indoor courts")).toBe("false");
    expect(pressed("All")).toBe("true");
  });
});
