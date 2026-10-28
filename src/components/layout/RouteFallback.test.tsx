// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RouteFallback, FALLBACK_ACTION_CLASS } from "./RouteFallback";

// This project registers no global test setup, so Testing Library's automatic
// cleanup is not installed — without this, each render stacks up in the same
// document and later queries match elements from earlier cases.
afterEach(cleanup);

/**
 * The point of this component is that a reader is never stranded, so the
 * assertions are mostly about escape routes existing and working — the exact
 * wording matters far less than there being something to click.
 */
describe("RouteFallback", () => {
  it("shows the title and message", () => {
    render(<RouteFallback title="Gym not found" message="It may have been removed." />);
    expect(screen.getByRole("heading", { name: "Gym not found" })).toBeTruthy();
    expect(screen.getByText("It may have been removed.")).toBeTruthy();
  });

  it("renders without a message", () => {
    render(<RouteFallback title="Something went wrong" />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
  });

  it("renders the caller's action so the reader has somewhere to go", () => {
    render(
      <RouteFallback
        title="Game not found"
        action={
          <a href="/feed" className={FALLBACK_ACTION_CLASS}>
            Back to feed
          </a>
        }
      />,
    );
    const link = screen.getByRole("link", { name: "Back to feed" });
    expect(link.getAttribute("href")).toBe("/feed");
  });

  it("offers a retry that calls the router's reset", () => {
    const reset = vi.fn();
    render(<RouteFallback title="Couldn't load this gym" onRetry={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("omits the retry button when there is nothing to retry", () => {
    render(<RouteFallback title="Gym not found" />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("can show a retry and a way out together", () => {
    render(
      <RouteFallback
        title="Couldn't load this payment"
        onRetry={() => {}}
        action={<a href="/feed">Back to feed</a>}
      />,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to feed" })).toBeTruthy();
  });

  it("always leaves at least one way onward when given either affordance", () => {
    // The regression this guards: a fallback that renders only prose, which is
    // what stranded readers on /terms and /privacy.
    for (const props of [
      { title: "A", onRetry: () => {} },
      { title: "B", action: <a href="/">Go home</a> },
    ]) {
      const { unmount, container } = render(<RouteFallback {...props} />);
      const clickable = container.querySelectorAll("a, button");
      expect(clickable.length).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe("RouteFallback with the error that caused it", () => {
  it("offers Reload, not Try again, when the page was open across an update", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    const onRetry = vi.fn();
    render(
      <RouteFallback
        title="Something went wrong"
        message="This game couldn't be loaded."
        error={new Error("Importing a module script failed.")}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("heading", { name: "BallaCity was updated" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("shows what actually failed, small, and keeps Try again for other errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRetry = vi.fn();
    render(
      <RouteFallback
        title="Something went wrong"
        message="This game couldn't be loaded."
        error={new Error("Cannot read properties of undefined (reading 'map')")}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/Details: Cannot read properties of undefined/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not repeat a message the page already shows", () => {
    render(
      <RouteFallback
        title="Couldn't load this gym"
        message="Gym is hidden"
        error={new Error("Gym is hidden")}
      />,
    );
    expect(screen.queryByText(/Details:/)).toBeNull();
  });
});
