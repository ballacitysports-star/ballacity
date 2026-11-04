import { describe, expect, it } from "vitest";
import {
  CLIENT_DATA_GENERATION,
  CLIENT_GENERATION_RELOAD_INTERVAL_MS,
  isClientOutdated,
  mayAutoReload,
  parseClientGeneration,
} from "./client-generation";

describe("minimum client generation", () => {
  it("this build is SEC-5 aware (reads organizers only through the views)", () => {
    expect(CLIENT_DATA_GENERATION).toBeGreaterThanOrEqual(5);
  });
  it("an unset or malformed flag never retires a build", () => {
    for (const v of [null, undefined, "5", { min: "9" }, { min: Number.NaN }, { min: -3 }]) {
      expect(isClientOutdated(parseClientGeneration(v))).toBe(false);
    }
  });
  it("retires a build below the minimum and keeps one at or above it", () => {
    expect(isClientOutdated({ min: 6, message: "" }, 5)).toBe(true);
    expect(isClientOutdated({ min: 5, message: "" }, 5)).toBe(false);
    expect(isClientOutdated(parseClientGeneration({ min: 5.9 }), 5)).toBe(false);
  });
  it("reloads automatically at most once per interval", () => {
    const now = 1_000_000_000_000;
    expect(mayAutoReload(null, now)).toBe(true);
    expect(mayAutoReload(now - 1000, now)).toBe(false);
    expect(mayAutoReload(now - CLIENT_GENERATION_RELOAD_INTERVAL_MS, now)).toBe(true);
    expect(mayAutoReload(now + 60_000, now)).toBe(true);
  });
  it("keeps the message short", () => {
    expect(parseClientGeneration({ min: 1, message: "x".repeat(900) }).message).toHaveLength(500);
  });
});
