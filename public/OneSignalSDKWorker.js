// Bypass the OneSignal SW entirely for Lovable's OAuth broker paths.
// If the SW handles /~oauth/* navigations it can drop the postMessage
// round-trip on iOS Chrome and leave the user stranded on /auth after
// a successful Google sign-in. Register a fetch listener BEFORE importing
// the OneSignal SW so our handler wins for those requests.
self.addEventListener("fetch", (event) => {
  try {
    const url = new URL(event.request.url);
    if (url.pathname.startsWith("/~oauth")) {
      event.respondWith(fetch(event.request));
    }
  } catch {
    /* ignore */
  }
});

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
