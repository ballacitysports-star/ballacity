// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const list = vi.fn();
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/error-report-admin.functions", () => ({
  superadminListErrors: (a: unknown) => list(a),
}));

import { ErrorsTab } from "./ErrorsTab";

const empty = { total: 0, capped: false, groups: [] };
const renderTab = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ErrorsTab />
    </QueryClientProvider>,
  );
const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed") === "true";
const lastCall = () => list.mock.calls.at(-1)?.[0];

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue(empty);
});
afterEach(() => cleanup());

describe("ErrorsTab views (P0-8)", () => {
  it("opens on the last 7 days of every source", async () => {
    renderTab();
    await waitFor(() => expect(lastCall()).toEqual({ data: { hours: 168, serverOnly: false } }));
    expect(pressed("Last 7 days")).toBe(true);
    expect(pressed("Server only")).toBe(false);
    expect(await screen.findByText("No errors reported in this period.")).toBeTruthy();
  });

  it("Last hour with Server only reads the first hour of server failures", async () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Last hour" }));
    await waitFor(() => expect(lastCall()).toEqual({ data: { hours: 1, serverOnly: false } }));
    fireEvent.click(screen.getByRole("button", { name: "Server only" }));
    await waitFor(() => expect(lastCall()).toEqual({ data: { hours: 1, serverOnly: true } }));
    expect(pressed("Last hour")).toBe(true);
    expect(pressed("Server only")).toBe(true);
    expect(screen.getByText(/pages that failed to render \(ssr\)/)).toBeTruthy();
    expect(await screen.findByText("No server errors reported in this period.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Server only" }));
    await waitFor(() => expect(lastCall()).toEqual({ data: { hours: 1, serverOnly: false } }));
  });

  it("keeps the day, 7-day and 30-day views", async () => {
    renderTab();
    for (const [name, hours] of [
      ["Last day", 24],
      ["Last 30 days", 720],
      ["Last 7 days", 168],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(lastCall()).toEqual({ data: { hours, serverOnly: false } }));
      expect(pressed(name)).toBe(true);
    }
  });

  it("lists the grouped errors it gets back", async () => {
    list.mockResolvedValue({
      total: 3,
      capped: false,
      groups: [
        {
          fingerprint: "a1",
          message: "TypeError: Cannot read properties of undefined",
          route: "/_serverFn/doThing",
          count: 3,
          signedInCount: 1,
          sources: ["server"],
          kinds: ["server_fn"],
          lastAt: "2026-11-11T11:30:00Z",
          firstAt: "2026-11-11T11:00:00Z",
        },
      ],
    });
    renderTab();
    expect(await screen.findByText("TypeError: Cannot read properties of undefined")).toBeTruthy();
    expect(screen.getByText("3×")).toBeTruthy();
    expect(
      screen.getByText(/\/_serverFn\/doThing · server · server_fn · 1 signed in/),
    ).toBeTruthy();
  });
});
