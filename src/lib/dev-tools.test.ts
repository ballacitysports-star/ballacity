import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isNotFound } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { devToolsEnabled, requireDevTools } from "./dev-tools";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("developer tools are development-only", () => {
  it("a production build answers a developer route with the 404", () => {
    vi.stubEnv("DEV", false);
    expect(devToolsEnabled()).toBe(false);
    let thrown: unknown;
    try {
      requireDevTools();
    } catch (err) {
      thrown = err;
    }
    expect(isNotFound(thrown)).toBe(true);
  });

  it("a development build (vite dev, Lovable preview) lets it through", () => {
    vi.stubEnv("DEV", true);
    expect(devToolsEnabled()).toBe(true);
    expect(() => requireDevTools()).not.toThrow();
  });

  const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

  for (const file of ["routes/dev.route-doctor.tsx", "routes/dev.og-preview.tsx"]) {
    it(`${file} is gated in beforeLoad`, () => {
      expect(read(file)).toMatch(/beforeLoad:\s*requireDevTools/);
    });
  }

  it("the 404 page links to the route doctor only in development builds", () => {
    const root = read("routes/__root.tsx");
    const link = root.indexOf("/dev/route-doctor?path=");
    expect(link).toBeGreaterThan(-1);
    expect(root.lastIndexOf("devToolsEnabled() &&", link)).toBeGreaterThan(
      root.lastIndexOf("function NotFoundComponent", link),
    );
  });
});
