// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, notFound, redirect } from "@tanstack/react-router";

// reportBrowserError is watched but still runs, so its once-per-page rule is the real one; only
// the network call it ends in is replaced.
const h = vi.hoisted(() => ({
  reportClientError: vi.fn(async (..._args: unknown[]) => ({ saved: true })),
}));
vi.mock("@/lib/error-report.functions", () => ({ reportClientError: h.reportClientError }));
vi.mock("@/lib/error-report-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/error-report-client")>();
  return { ...real, reportBrowserError: vi.fn(real.reportBrowserError) };
});
// A small app: a page that throws while rendering, and one whose loader gets a server function's
// refusal of a malformed id, each with its own error screen.
vi.mock("./routeTree.gen", async () => {
  const { createElement } = await import("react");
  const { z } = await import("zod");
  const { createRootRoute, createRoute, Outlet } = await import("@tanstack/react-router");
  const root = createRootRoute({ component: () => createElement(Outlet) });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => {
      throw new Error("route broke");
    },
    errorComponent: () => createElement("p", null, "Route error screen"),
  });
  const org = createRoute({
    getParentRoute: () => root,
    path: "/orgs/$orgId",
    loader: ({ params }) => {
      // The server's ZodError as the browser gets it back: the message only.
      const parsed = z.object({ id: z.string().uuid() }).safeParse({ id: params.orgId });
      if (!parsed.success) throw new Error(parsed.error.message);
    },
    component: () => createElement("p", null, "Org page"),
    errorComponent: () => createElement("p", null, "Org error screen"),
  });
  return { routeTree: root.addChildren([index, org]) };
});

import { getRouter } from "./router";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { reportBrowserError, resetBrowserErrorReporting } from "@/lib/error-report-client";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const info = { componentStack: "" };

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  resetBrowserErrorReporting();
  vi.mocked(reportBrowserError).mockClear();
  h.reportClientError.mockClear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  // React and the router log caught errors; keep the output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("route error screens report what they caught (P0-8)", () => {
  it("a route's errorComponent shows and the error is reported once, as a boundary error", async () => {
    render(<RouterProvider router={getRouter()} />);
    expect(await screen.findByText("Route error screen")).toBeTruthy();
    expect(reportBrowserError).toHaveBeenCalledTimes(1);
    expect(reportBrowserError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "route broke" }),
      "boundary",
    );
    await waitFor(() => expect(h.reportClientError).toHaveBeenCalledTimes(1));
    expect(h.reportClientError).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "boundary",
        message: "Error: route broke",
        route: "/",
      }),
    });
  });

  it("redirects and notFound are navigation, not failures", async () => {
    const { defaultOnCatch } = getRouter().options;
    defaultOnCatch?.(redirect({ to: "/auth" }), info);
    defaultOnCatch?.(notFound(), info);
    await flush();
    expect(reportBrowserError).not.toHaveBeenCalled();
    expect(h.reportClientError).not.toHaveBeenCalled();
  });

  it("a loader's bad-input refusal shows the error screen and is not reported", async () => {
    window.history.replaceState(null, "", "/orgs/not-a-uuid");
    render(<RouterProvider router={getRouter()} />);
    expect(await screen.findByText("Org error screen")).toBeTruthy();
    await flush();
    expect(reportBrowserError).not.toHaveBeenCalled();
    expect(h.reportClientError).not.toHaveBeenCalled();
  });

  it("validation errors and auth refusals are answers, not failures: none is reported", async () => {
    const { defaultOnCatch } = getRouter().options;
    const zodError = Object.assign(new Error("[]"), { name: "ZodError", issues: [] });
    for (const error of [
      zodError,
      new Error(JSON.stringify([{ code: "invalid_type", path: ["id"], message: "Required" }])),
      new Error("Unauthorized: No authorization header provided"),
      new Error("Forbidden"),
      new Error("NOT_SIGNED_IN"),
      new Error("JWT expired"),
    ]) {
      defaultOnCatch?.(error, info);
    }
    await flush();
    expect(reportBrowserError).not.toHaveBeenCalled();
    expect(h.reportClientError).not.toHaveBeenCalled();
  });

  it("an error GlobalErrorBoundary already reported is not sent again by the router", async () => {
    const error = new Error("seen by both");
    function Boom(): never {
      throw error;
    }
    render(
      <GlobalErrorBoundary>
        <Boom />
      </GlobalErrorBoundary>,
    );
    getRouter().options.defaultOnCatch?.(error, info);
    await flush();
    // Both handed it to the reporter; it was sent once.
    expect(reportBrowserError).toHaveBeenCalledTimes(2);
    expect(reportBrowserError).toHaveBeenNthCalledWith(2, error, "boundary");
    expect(h.reportClientError).toHaveBeenCalledTimes(1);
    expect(h.reportClientError).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "boundary", message: "Error: seen by both" }),
    });
  });
});
