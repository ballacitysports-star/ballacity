import { useEffect, useState, type ReactNode } from "react";
import { Download, EllipsisVertical, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "ballacity:pwa-dismissed-at";
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 4000;

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * native      — Chromium on Android fired beforeinstallprompt; one-tap install.
 * ios-safari  — Safari share sheet.
 * ios-other   — Chrome/Edge/Firefox on iOS (WebKit, different toolbar).
 * android-menu — Android browser without the native event (Firefox, Samsung edge cases).
 * in-app      — Instagram/Facebook/TikTok/etc. webviews can't install at all.
 */
type Mode = "native" | "ios-safari" | "ios-other" | "android-menu" | "in-app";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true ||
    document.referrer.startsWith("android-app://")
  );
}

function detect(): { os: "ios" | "android" | "other"; mode: Exclude<Mode, "native"> | null; browser: string } {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const os = ios ? "ios" : android ? "android" : "other";
  if (os === "other") return { os, mode: null, browser: "" };

  const inApp =
    /FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|Snapchat|Twitter|LinkedInApp|Pinterest|GSA\//i.test(ua) ||
    (android && /; wv\)/.test(ua));
  if (inApp) return { os, mode: "in-app", browser: "" };

  if (ios) {
    if (/CriOS/.test(ua)) return { os, mode: "ios-other", browser: "Chrome" };
    if (/EdgiOS/.test(ua)) return { os, mode: "ios-other", browser: "Edge" };
    if (/FxiOS/.test(ua)) return { os, mode: "ios-other", browser: "Firefox" };
    if (/OPiOS|OPT\//.test(ua)) return { os, mode: "ios-other", browser: "Opera" };
    return { os, mode: "ios-safari", browser: "Safari" };
  }
  if (/Firefox/i.test(ua)) return { os, mode: "android-menu", browser: "Firefox" };
  if (/SamsungBrowser/i.test(ua)) return { os, mode: "android-menu", browser: "Samsung Internet" };
  return { os, mode: "android-menu", browser: "your browser" };
}

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || "0");
    return at > 0 && Date.now() - at < COOLDOWN_MS;
  } catch {
    return false;
  }
}

/** Asks mobile visitors who haven't installed BallaCity to add it to their home screen. */
export function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [info, setInfo] = useState<ReturnType<typeof detect> | null>(null);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed() || window.self !== window.top) return;
    const d = detect();
    setInfo(d);
    if (!d.mode) return;

    let gotNative = false;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      gotNative = true;
      setDeferred(e as BIPEvent);
      setMode((m) => (m === null || m === "android-menu" ? "native" : m));
    };
    const onInstalled = () => setMode(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // Give Chromium a moment to fire its native install event before falling
    // back to manual menu instructions.
    const t = setTimeout(() => {
      setMode((m) => m ?? (gotNative ? "native" : d.mode));
    }, SHOW_DELAY_MS);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setMode(null);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === "accepted") setMode(null);
    else dismiss();
  };

  if (!mode || !info) return null;

  const browser = info.browser;
  const steps: ReactNode[] | null =
    mode === "ios-safari"
      ? [
          <>Tap <Share className="h-4 w-4 text-primary" /> <b>Share</b> in Safari's toolbar</>,
          <>Choose <SquarePlus className="h-4 w-4 text-primary" /> <b>Add to Home Screen</b></>,
          <>Tap <b>Add</b></>,
        ]
      : mode === "ios-other"
        ? [
            <>Tap <Share className="h-4 w-4 text-primary" /> <b>Share</b> in {browser} (next to the address bar, or under <b>•••</b>)</>,
            <>Choose <SquarePlus className="h-4 w-4 text-primary" /> <b>Add to Home Screen</b></>,
            <>Tap <b>Add</b></>,
          ]
        : mode === "android-menu"
          ? [
              <>Tap the <EllipsisVertical className="h-4 w-4 text-primary" /> <b>menu</b> in {browser}</>,
              <>Choose <b>Install</b> or <b>Add to Home screen</b></>,
              <>Confirm with <b>Add</b></>,
            ]
          : mode === "in-app"
            ? [
                <>Tap the <b>•••</b> or <EllipsisVertical className="h-4 w-4 text-primary" /> menu in this app</>,
                <>Choose <b>Open in {info.os === "ios" ? "Safari" : "Chrome"}</b> (or "Open in browser")</>,
                <>Then add BallaCity to your home screen from there</>,
              ]
            : null;

  return (
    <div
      role="dialog"
      aria-label="Install BallaCity"
      className="fixed inset-x-3 z-[60] rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-2xl"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 84px)" }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-3 pr-6">
        <img src="/icons/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
        <div>
          <p className="font-semibold">Get the BallaCity app</p>
          <p className="text-xs text-muted-foreground">
            {mode === "in-app"
              ? "Open this page in your browser to install it — free."
              : "Full screen, faster loading and game alerts — free."}
          </p>
        </div>
      </div>
      {mode === "native" ? (
        <div className="mt-3 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={dismiss}>
            Not now
          </Button>
          <Button className="flex-1" onClick={install}>
            <Download className="mr-1 h-4 w-4" /> Install
          </Button>
        </div>
      ) : (
        <ol className="mt-3 space-y-1.5 text-sm">
          {steps?.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1">
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
