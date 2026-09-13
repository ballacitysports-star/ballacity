import { describe, it, expect, afterEach, vi } from "vitest";
import { detectDistanceUnit, resetDetectedDistanceUnit } from "./measurement-system";

function withLocale(languages: string[], timeZone = "Europe/Berlin") {
  vi.stubGlobal("navigator", { languages, language: languages[0] });
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation((() => ({
    resolvedOptions: () => ({ timeZone }),
  })) as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetDetectedDistanceUnit();
});

describe("detectDistanceUnit", () => {
  it("uses miles for US locales", () => {
    withLocale(["en-US"], "America/New_York");
    expect(detectDistanceUnit()).toBe("mi");
  });

  it("uses miles for the UK", () => {
    withLocale(["en-GB"], "Europe/London");
    expect(detectDistanceUnit()).toBe("mi");
  });

  it("uses kilometers for Germany", () => {
    withLocale(["de-DE"], "Europe/Berlin");
    expect(detectDistanceUnit()).toBe("km");
  });

  it("uses kilometers for France even on an English locale list tail", () => {
    withLocale(["fr-FR", "en-US"], "Europe/Paris");
    expect(detectDistanceUnit()).toBe("km");
  });

  it("uses miles for Myanmar", () => {
    withLocale(["my-MM"], "Asia/Yangon");
    expect(detectDistanceUnit()).toBe("mi");
  });

  it("falls back to timezone when the locale has no region", () => {
    withLocale(["en"], "America/Chicago");
    expect(detectDistanceUnit()).toBe("mi");
    resetDetectedDistanceUnit();
    withLocale(["en"], "Europe/Madrid");
    expect(detectDistanceUnit()).toBe("km");
  });

  it("falls back to miles without a navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(detectDistanceUnit()).toBe("mi");
  });
});
