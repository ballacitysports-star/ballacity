import { describe, expect, it } from "vitest";

import { isRequestAbort } from "./request-abort";

describe("isRequestAbort", () => {
  it("recognizes AbortController cancellations", () => {
    expect(isRequestAbort(new DOMException("This operation was aborted", "AbortError"))).toBe(true);
  });

  it("recognizes Node HTTP socket-close cancellations", () => {
    expect(isRequestAbort(new Error("aborted"))).toBe(true);
    expect(isRequestAbort({ code: "ECONNRESET", message: "socket hang up" })).toBe(true);
  });

  it("recognizes nested cancellation causes", () => {
    expect(isRequestAbort(new Error("render failed", { cause: new Error("aborted") }))).toBe(true);
  });

  it("does not hide unrelated failures", () => {
    expect(isRequestAbort(new Error("Database request failed"))).toBe(false);
    expect(isRequestAbort(null)).toBe(false);
  });
});