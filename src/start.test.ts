import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reportServerError: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock("@/lib/error-report.server", () => ({ reportServerError: h.reportServerError }));
// The real attacher loads the browser Supabase client; only its place in the list matters here.
vi.mock("@/integrations/supabase/auth-attacher", async () => {
  const { createMiddleware } = await import("@tanstack/react-start");
  return {
    attachSupabaseAuth: createMiddleware({ type: "function" }).client(async ({ next }) => next()),
  };
});

import { errorMiddleware, startInstance } from "./start";
import { errorReportMiddleware } from "./lib/error-report-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const server = errorMiddleware.options.server!;
const run = (request: Request, next: () => Promise<unknown>) =>
  server({
    request,
    next,
    pathname: new URL(request.url).pathname,
    context: {},
    handlerType: "router",
  } as unknown as Parameters<typeof server>[0]) as Promise<Response>;
const page = (path = "/games/42") => new Request(`https://ballacity.example${path}`);

beforeEach(() => {
  h.reportServerError.mockReset();
  h.reportServerError.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("src/start.ts wiring (P0-8)", () => {
  it("registers the server-function reporter after the auth attacher, and the 500 page middleware", async () => {
    const options = await startInstance.getOptions();
    expect(options.functionMiddleware).toEqual([attachSupabaseAuth, errorReportMiddleware]);
    expect(options.requestMiddleware).toContain(errorMiddleware);
  });

  it("reports a page failure as ssr, then returns the 500 page", async () => {
    const error = new Error("render broke");
    const request = page();
    const response = await run(request, () => Promise.reject(error));
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("This page didn't load");
    expect(h.reportServerError).toHaveBeenCalledTimes(1);
    expect(h.reportServerError).toHaveBeenCalledWith(error, request, "ssr");
  });

  it("a reporter that fails never changes the 500 page", async () => {
    h.reportServerError.mockRejectedValueOnce(new Error("db down"));
    const first = await run(page(), () => Promise.reject(new Error("render broke")));
    h.reportServerError.mockImplementationOnce(() => {
      throw new Error("sync failure");
    });
    const second = await run(page(), () => Promise.reject(new Error("render broke")));
    for (const response of [first, second]) {
      expect(response.status).toBe(500);
      expect(await response.text()).toContain("This page didn't load");
    }
  });

  it("reports nothing when the visitor left, and answers 499", async () => {
    const left = new AbortController();
    left.abort();
    const request = new Request("https://ballacity.example/feed", { signal: left.signal });
    const response = await run(request, () => Promise.reject(new Error("render broke")));
    expect(response.status).toBe(499);
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect((await run(page(), () => Promise.reject(abort))).status).toBe(499);
    expect(h.reportServerError).not.toHaveBeenCalled();
  });

  it("rethrows HTTP errors that carry their own status, without a report", async () => {
    const httpError = Object.assign(new Error("Not Found"), { statusCode: 404 });
    await expect(run(page(), () => Promise.reject(httpError))).rejects.toBe(httpError);
    expect(h.reportServerError).not.toHaveBeenCalled();
  });

  it("leaves platform routes and successful responses alone", async () => {
    const error = new Error("webhook broke");
    await expect(run(page("/lovable/email/hook"), () => Promise.reject(error))).rejects.toBe(error);
    const ok = new Response("fine");
    await expect(run(page(), () => Promise.resolve(ok))).resolves.toBe(ok);
    expect(h.reportServerError).not.toHaveBeenCalled();
  });
});
