import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GA_FALLBACK_MEASUREMENT_ID, resolveGaMeasurementId } from "./ga-measurement-id";

describe("resolveGaMeasurementId", () => {
  it("uses the id it is given", () => {
    expect(resolveGaMeasurementId("G-ABC123")).toBe("G-ABC123");
    expect(resolveGaMeasurementId("  G-ABC123 \n")).toBe("G-ABC123");
  });

  it("falls back to the published property when nothing is set", () => {
    for (const raw of [undefined, "", "   "]) {
      expect(resolveGaMeasurementId(raw)).toBe(GA_FALLBACK_MEASUREMENT_ID);
    }
  });

  it("turns analytics off for an explicit off value, in any case", () => {
    for (const raw of ["off", "OFF", " Off ", "none", "disabled", "DISABLED"]) {
      expect(resolveGaMeasurementId(raw)).toBe("");
    }
  });

  it("is what vite.config.ts bakes into the client build", () => {
    const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(config).toMatch(
      /"import\.meta\.env\.VITE_GA_MEASUREMENT_ID":\s*JSON\.stringify\(\s*resolveGaMeasurementId\(process\.env\.GOOGLE_ANALYTICS_MEASUREMENT_ID\)/,
    );
    expect(config).not.toContain(GA_FALLBACK_MEASUREMENT_ID);
  });
});
