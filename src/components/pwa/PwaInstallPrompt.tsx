import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "ballacity:pwa-dismissed-at";
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 4000;

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true ||
    document.referrer.startsWith("android-app://")
  );
}

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || isIos();
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
  const [mode, setMode] = useState<"android" | "ios" | null>(null);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed() || window.self !== window.top) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
      setTimeout(() => setMode("android"), SHOW_DELAY_MS);
    };
    const onInstalled = () => setMode(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    let t: ReturnType<typeof setTimeout> | undefined;
    if (isIos() && isMobile()) t = setTimeout(() => setMode("ios"), SHOW_DELAY_MS);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
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

  if (!mode) return null;

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
            Full screen, faster loading and game alerts — free.
          </p>
        </div>
      </div>
      {mode === "android" ? (
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
          <li className="flex items-center gap-2">
            1. Tap <Share className="h-4 w-4 text-primary" /> <b>Share</b> in Safari
          </li>
          <li className="flex items-center gap-2">
            2. Choose <SquarePlus className="h-4 w-4 text-primary" /> <b>Add to Home Screen</b>
          </li>
          <li>
            3. Tap <b>Add</b>
          </li>
        </ol>
      )}
    </div>
  );
}
