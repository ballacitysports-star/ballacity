// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_WATCHDOG_DEV_OPT_IN,
  BOOT_WATCHDOG_RETRY_KEY,
  bootWatchdogInlineScript,
} from "./boot-watchdog";

type WatchdogWindow = Window & { __openrun_booted?: boolean } & Record<string, unknown>;

/** Run the inline script the way the browser does: as a classic script in the page. */
function runInline(script: string) {
  new Function(script)();
}

describe("bootWatchdogInlineScript", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    document.body.innerHTML = "";
    delete (window as unknown as WatchdogWindow).__openrun_booted;
    delete (window as unknown as WatchdogWindow)[BOOT_WATCHDOG_DEV_OPT_IN];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A stamp says the one automatic reload already happened, so a stall shows the panel. */
  const alreadyReloadedOnce = () =>
    sessionStorage.setItem(BOOT_WATCHDOG_RETRY_KEY, String(Date.now()));

  it("in production, surfaces the recovery actions when the app never boots", () => {
    alreadyReloadedOnce();
    runInline(bootWatchdogInlineScript(false));
    vi.advanceTimersByTime(20_000);

    expect(document.body.textContent).toContain("We could not finish loading");
    expect(document.getElementById("boot-retry")?.textContent).toBe("Try again");
  });

  it("in production, stands down once the app has booted", () => {
    alreadyReloadedOnce();
    runInline(bootWatchdogInlineScript(false));
    (window as unknown as WatchdogWindow).__openrun_booted = true;
    vi.advanceTimersByTime(70_000);

    expect(document.getElementById("boot-fallback")).toBeNull();
  });

  it("in development, stays off and only clears a leftover retry stamp", () => {
    alreadyReloadedOnce();
    runInline(bootWatchdogInlineScript(true));
    vi.advanceTimersByTime(70_000);

    expect(document.getElementById("boot-fallback")).toBeNull();
    expect(sessionStorage.getItem(BOOT_WATCHDOG_RETRY_KEY)).toBeNull();
  });

  it("in development, runs the same watchdog when a test harness opts in first", () => {
    (window as unknown as WatchdogWindow)[BOOT_WATCHDOG_DEV_OPT_IN] = true;
    alreadyReloadedOnce();
    runInline(bootWatchdogInlineScript(true));
    vi.advanceTimersByTime(20_000);

    expect(document.body.textContent).toContain("We could not finish loading");
  });

  it("in development, ignores an opt-in that is anything but true", () => {
    (window as unknown as WatchdogWindow)[BOOT_WATCHDOG_DEV_OPT_IN] = "1";
    alreadyReloadedOnce();
    runInline(bootWatchdogInlineScript(true));
    vi.advanceTimersByTime(70_000);

    expect(document.getElementById("boot-fallback")).toBeNull();
  });
});
