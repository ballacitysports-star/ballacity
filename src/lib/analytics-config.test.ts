import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function envValue(file: string, key: string): string | undefined {
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).replace(/^"|"$/g, "");
}

describe("GA4 configuration", () => {
  it("production has one well-formed GA4 measurement id", () => {
    const id = envValue(".env.production", "VITE_GA_MEASUREMENT_ID");
    expect(id).toMatch(/^G-[A-Z0-9]{6,12}$/);
    const count = readFileSync(".env.production", "utf8")
      .split("\n")
      .filter((l) => l.startsWith("VITE_GA_MEASUREMENT_ID=")).length;
    expect(count).toBe(1);
  });

  it("the example file documents the variable without a real id", () => {
    expect(envValue(".env.example", "VITE_GA_MEASUREMENT_ID")).toBe("");
  });

  it("the tag still turns off Google signals and ad personalization", () => {
    const src = readFileSync("src/lib/analytics.ts", "utf8");
    expect(src).toMatch(/allow_google_signals:\s*false/);
    expect(src).toMatch(/allow_ad_personalization_signals:\s*false/);
  });
});
