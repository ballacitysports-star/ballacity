// Bypass the OneSignal SW entirely for Lovable's OAuth broker paths AND for
// any top-level page navigation. Registering this fetch listener BEFORE
// importing the OneSignal SW ensures our handler wins.
//
// - /~oauth/*: if the SW handles these it can drop the postMessage round-trip
//   on iOS Chrome and leave the user stranded on /auth after Google sign-in.
// - navigate requests: if the SW ever returns a cached shell for a page
//   navigation the router can resolve to the wrong route (e.g. landing "/"
//   instead of the refreshed protected page) on mobile.
self.addEventListener("fetch", (event) => {
  try {
    if (event.request.mode === "navigate") {
      event.respondWith(fetch(event.request));
      return;
    }
    const url = new URL(event.request.url);
    if (url.pathname.startsWith("/~oauth")) {
      event.respondWith(fetch(event.request));
    }
  } catch {
    /* ignore */
  }
});

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
