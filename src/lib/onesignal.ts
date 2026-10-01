// OneSignal Web Push integration
// App ID is public; safe to inline.
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { isManagedUser } from "@/lib/managed-children";
import { openDeepLink } from "@/lib/deep-links";

export const ONESIGNAL_APP_ID = "c6024ea7-b1a2-4f64-b43a-783971d802f9";

declare global {
  interface Window {
    OneSignal?: any;
    OneSignalDeferred?: Array<(os: any) => void>;
    __openrunOneSignalLoaded?: boolean;
    __openrunOneSignalInited?: boolean;
  }
}

function loadSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.__openrunOneSignalLoaded) return resolve();
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    const s = document.createElement("script");
    s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    s.defer = true;
    s.onload = () => {
      window.__openrunOneSignalLoaded = true;
      resolve();
    };
    s.onerror = () => reject(new Error("Failed to load OneSignal SDK"));
    document.head.appendChild(s);
  });
}

/**
 * Routes taps on push alerts to the exact game / chat / profile they refer to.
 * When the app is already open we route client-side instead of reloading.
 */
function attachClickHandler(OneSignal: any) {
  if (typeof window === "undefined") return;
  if ((window as any).__openrunOneSignalClickBound) return;
  try {
    OneSignal.Notifications.addEventListener("click", (event: any) => {
      const url: string | undefined =
        event?.result?.url ??
        event?.notification?.launchURL ??
        event?.notification?.url ??
        event?.notification?.additionalData?.url;
      if (!url) return;
      openDeepLink(url, event?.notification?.additionalData?.type ?? null);
    });
    (window as any).__openrunOneSignalClickBound = true;
  } catch (e) {
    console.warn("[onesignal] click handler failed", e);
  }
}

async function initOneSignal(userId: string) {
  if (typeof window === "undefined") return;
  try {
    await loadSdk();
  } catch (e) {
    console.warn("[onesignal] sdk load failed", e);
    return;
  }
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    try {
      if (!window.__openrunOneSignalInited) {
        await OneSignal.init({
          appId: ONESIGNAL_APP_ID,
          allowLocalhostAsSecureOrigin: true,
          serviceWorkerPath: "/OneSignalSDKWorker.js",
          notifyButton: { enable: false },
        });
        window.__openrunOneSignalInited = true;
      }
      attachClickHandler(OneSignal);
      // Tie the device/subscription to the Supabase user id (external_id alias)
      try {
        await OneSignal.login(userId);
      } catch (e) {
        console.warn("[onesignal] login failed", e);
      }
      // Gently prompt for permission if still default
      if (
        typeof window.Notification !== "undefined" &&
        window.Notification.permission === "default"
      ) {
        try {
          await OneSignal.Slidedown.promptPush({ force: false });
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      console.warn("[onesignal] init error", e);
    }
  });
}

export async function logoutOneSignal() {
  if (typeof window === "undefined") return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    try {
      await OneSignal.logout();
    } catch {
      /* ignore */
    }
  });
}

/** Runs `fn` once the OneSignal SDK is loaded and initialized. */
async function withOneSignal<T>(fn: (os: any) => Promise<T>): Promise<T | null> {
  if (typeof window === "undefined") return null;
  try {
    await loadSdk();
  } catch (e) {
    console.warn("[onesignal] sdk load failed", e);
    return null;
  }
  return new Promise<T | null>((resolve) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      try {
        resolve(await fn(OneSignal));
      } catch (e) {
        console.warn("[onesignal] call failed", e);
        resolve(null);
      }
    });
  });
}

/**
 * Opts the current device into OneSignal web push. This is what actually
 * creates the push subscription (and, on Safari/iOS, triggers the native
 * permission sheet) so closed-app alerts can be delivered.
 */
export async function optInOneSignalPush(): Promise<boolean> {
  const result = await withOneSignal(async (OneSignal: any) => {
    if (!window.__openrunOneSignalInited) {
      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerPath: "/OneSignalSDKWorker.js",
        notifyButton: { enable: false },
      });
      window.__openrunOneSignalInited = true;
    }
    attachClickHandler(OneSignal);
    await OneSignal.User.PushSubscription.optIn();
    return OneSignal.User.PushSubscription.optedIn === true;
  });
  return result === true;
}

/** True when this device currently has an active OneSignal push subscription. */
export async function isOneSignalSubscribed(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.__openrunOneSignalInited) return false;
  const result = await withOneSignal(
    async (OneSignal: any) => OneSignal.User.PushSubscription.optedIn === true,
  );
  return result === true;
}

/** Mount once near the app root; initializes OneSignal for the signed-in user. */
export function useOneSignal() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const managed = isManagedUser(user);
  useEffect(() => {
    // A managed child has no device of their own: this is the guardian's
    // device, acting as the child. Leave it tied to the guardian so their own
    // alerts keep arriving and the child's subscription never claims it.
    if (!userId || managed) return;
    void initOneSignal(userId);
  }, [userId, managed]);
}
