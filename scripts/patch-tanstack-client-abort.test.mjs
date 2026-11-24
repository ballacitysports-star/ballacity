// scripts/patch-tanstack-client-abort.mjs runs on postinstall and only warns when TanStack's handler no longer matches
// its pattern, so an upgrade could drop the fix without anyone noticing: a visitor leaving mid-render would turn back
// into an unhandled 500 "Error: aborted". This test reads the handler the install left behind and fails instead.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HANDLER = new URL(
  "../node_modules/@tanstack/start-server-core/dist/esm/createStartHandler.js",
  import.meta.url,
);

describe("TanStack client-abort patch", () => {
  it("is applied to the installed server handler", () => {
    const source = readFileSync(HANDLER, "utf8");
    expect(
      source,
      "postinstall did not patch createStartHandler.js: update the pattern in scripts/patch-tanstack-client-abort.mjs",
    ).toContain('statusText: "Client Closed Request"');
    expect(source).toContain("status: 499");
  });

  it("is applied once, however many times the install runs", () => {
    const source = readFileSync(HANDLER, "utf8");
    expect(source.split("Client Closed Request").length - 1).toBe(1);
  });
});
