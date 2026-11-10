// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GlobalErrorBoundary } from "./GlobalErrorBoundary";

/** Throws `error` while `fail.current` is true. */
function Boom({ fail, error }: { fail: { current: boolean }; error: Error }) {
  if (fail.current) throw error;
  return <p>All good</p>;
}

let reload: ReturnType<typeof vi.fn>;
const realLocation = window.location;

beforeEach(() => {
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, reload },
  });
  sessionStorage.clear();
  // React logs caught render errors; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("DEV", false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

const chunkError = () =>
  new TypeError("Failed to fetch dynamically imported module: /assets/route-abc.js");

describe("GlobalErrorBoundary", () => {
  it("shows its children when nothing throws", () => {
    render(
      <GlobalErrorBoundary>
        <p>All good</p>
      </GlobalErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeTruthy();
  });

  it("replaces a crashed subtree with a recoverable screen with a way out", () => {
    render(
      <GlobalErrorBoundary title="Could not load the game">
        <Boom fail={{ current: true }} error={new Error("kaboom")} />
      </GlobalErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Could not load the game")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
    // Outside development the raw error message is not shown to members.
    expect(screen.queryByText("kaboom")).toBeNull();
  });

  it("Try again renders the subtree again", () => {
    const fail = { current: true };
    render(
      <GlobalErrorBoundary>
        <Boom fail={fail} error={new Error("kaboom")} />
      </GlobalErrorBoundary>,
    );
    fail.current = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("All good")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once for a stale-deploy chunk error, not again within two minutes", () => {
    render(
      <GlobalErrorBoundary>
        <Boom fail={{ current: true }} error={chunkError()} />
      </GlobalErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("openrun:boot-retry-at")).not.toBeNull();

    cleanup();
    render(
      <GlobalErrorBoundary>
        <Boom fail={{ current: true }} error={chunkError()} />
      </GlobalErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("reloads again once the two-minute window has passed", () => {
    sessionStorage.setItem("openrun:boot-retry-at", String(Date.now() - 121_000));
    render(
      <GlobalErrorBoundary>
        <Boom fail={{ current: true }} error={chunkError()} />
      </GlobalErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads for an ordinary error or an aborted request", () => {
    render(
      <GlobalErrorBoundary>
        <Boom fail={{ current: true }} error={new Error("Cannot read properties of undefined")} />
      </GlobalErrorBoundary>,
    );
    cleanup();
    const aborted = new Error("Failed to fetch dynamically imported module (aborted)");
    render(
      <GlobalErrorBoundary>
        <Boom fail={{ current: true }} error={aborted} />
      </GlobalErrorBoundary>,
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("never reloads in development, where Vite owns reloads", () => {
    vi.stubEnv("DEV", true);
    render(
      <GlobalErrorBoundary>
        <Boom fail={{ current: true }} error={chunkError()} />
      </GlobalErrorBoundary>,
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps the rest of the page when a nested boundary catches", () => {
    function Page() {
      const [fail] = useState({ current: true });
      return (
        <div>
          <p>Header stays</p>
          <GlobalErrorBoundary scope="section">
            <Boom fail={fail} error={new Error("section broke")} />
          </GlobalErrorBoundary>
        </div>
      );
    }
    render(<Page />);
    expect(screen.getByText("Header stays")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
