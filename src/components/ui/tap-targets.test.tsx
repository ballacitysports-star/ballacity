// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";
import { Switch } from "./switch";
import { AddToCalendarButton } from "@/components/datetime/AddToCalendarButton";

/**
 * WP 4.3: the shared controls are 44px tap targets. jsdom does no layout, so this checks the classes that give the
 * size: h-11/w-11 (44px) on the close buttons, min-h-11 on the calendar menu, and the switch's invisible ::after that
 * widens a 20x36 track (16x32 inside its 2px border) to 44x44.
 */
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

function classesOf(el: HTMLElement) {
  return el.className.split(/\s+/);
}

describe("44px tap targets", () => {
  it("the dialog's close X is a 44px button", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Body</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const close = within(screen.getByRole("dialog")).getByRole("button", { name: "Close" });
    expect(classesOf(close)).toEqual(expect.arrayContaining(["h-11", "w-11"]));
  });

  it("the sheet's close X is a 44px button", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Body</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const close = within(screen.getByRole("dialog")).getByRole("button", { name: "Close" });
    expect(classesOf(close)).toEqual(expect.arrayContaining(["h-11", "w-11"]));
  });

  it("a switch keeps its small track but takes taps over 44x44", () => {
    render(<Switch aria-label="Notify me" />);
    const sw = screen.getByRole("switch", { name: "Notify me" });
    const c = classesOf(sw);
    // The track: 20px (h-5) by 36px (w-9), border-box with border-2, so its padding box (where an absolute ::after is
    // measured from) is 16x32. The hit area adds 14px above and below and 6px each side: 44x44.
    expect(c).toEqual(
      expect.arrayContaining([
        "h-5",
        "w-9",
        "relative",
        "after:absolute",
        "border-2",
        "after:-inset-y-3.5",
        "after:-inset-x-1.5",
      ]),
    );
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("Add to calendar and each of its choices are 44px high", () => {
    render(
      <AddToCalendarButton
        event={{ title: "Pickup game", start: "2026-12-01T18:00:00Z", end: "2026-12-01T19:30:00Z" }}
      />,
    );
    const open = screen.getByRole("button", { name: "Add to calendar" });
    expect(classesOf(open)).toContain("min-h-11");
    fireEvent.click(open);
    for (const el of [
      screen.getByRole("link", { name: "Google Calendar" }),
      screen.getByRole("link", { name: "Outlook" }),
      screen.getByRole("button", { name: "Apple / .ics file" }),
    ]) {
      expect(classesOf(el)).toContain("min-h-11");
    }
  });
});
