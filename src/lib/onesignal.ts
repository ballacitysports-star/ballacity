// OneSignal Web Push integration
// App ID is public; safe to inline.
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

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

/** Mount once near the app root; initializes OneSignal for the signed-in user. */
export function useOneSignal() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    void initOneSignal(user.id);
  }, [user?.id]);
}
