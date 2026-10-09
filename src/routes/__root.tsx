import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import appCss from "../styles.css?url";
import { SITE_DESCRIPTION, SITE_TITLE } from "@/lib/seo";
import { DebugModeToggle } from "@/components/DebugModeToggle";
import { BottomNav } from "@/components/BottomNav";
import { SwipeNavigator } from "@/components/navigation/SwipeNavigator";
import { ClientOnly } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { runLegacyHostMigration } from "@/lib/legacy-host-migration";
import { useAuth } from "@/hooks/use-auth";
import { useNotificationPush } from "@/lib/notifications";
import { useGameReminderFlush } from "@/lib/game-reminders";
import { useOneSignal } from "@/lib/onesignal";
import { logAuthGateDecision, readStoredSupabaseSession } from "@/lib/authgate-log";
import { clearLastVisited, rememberLastVisited } from "@/lib/last-visited";
import {
  type AccountType,
  type SetupId,
  clearPendingAccountType,
  isAccountType,
  readPendingAccountType,
  routeForSetup,
} from "@/lib/account-type";
import { getOnboardingStatus } from "@/lib/onboarding.functions";
import { getMyAgeStatus } from "@/lib/age-verification.functions";
import { CHILD_CONSENT_ROUTE, isAccountSetupEscape, needsAgeGate } from "@/lib/age-verification";
import { parseCohort, requiresParentalConsent } from "@/lib/child-policy";
import { AgeGateScreen } from "@/components/onboarding/AgeGateScreen";
import { AccountTypeScreen } from "@/components/onboarding/AccountTypeScreen";
import { logNotFound } from "@/lib/route-doctor";
import { ErrorFallback, GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { setDeepLinkNavigator } from "@/lib/deep-links";
import { useSessionHeartbeat } from "@/hooks/use-session-heartbeat";
import { useManagedSessionWatcher } from "@/hooks/use-managed-session";
import { ManagedSessionBanner } from "@/components/ManagedSessionBanner";
import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";

function NotFoundComponent() {
  const router = useRouter();
  const [path, setPath] = useState("");

  useEffect(() => {
    const attempted = window.location.pathname + window.location.search;
    setPath(attempted);
    console.warn("[404] no route matched:", attempted);
    logNotFound(attempted, document.referrer || "");
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        {path && (
          <p className="mt-3 break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-muted-foreground">
            {path}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => router.history.back()}
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface"
          >
            Go back
          </button>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
        <div className="mt-4">
          <a
            href={`/dev/route-doctor?path=${encodeURIComponent(path)}`}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Diagnose this link
          </a>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <ErrorFallback
      error={error instanceof Error ? error : new Error(String(error))}
      title="This page didn't load"
      description="Something went wrong on our end. You can try again or head back home."
      onRetry={() => {
        router.invalidate();
        reset();
      }}
    />
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "author", content: "BallaCity" },
      { property: "og:site_name", content: "BallaCity" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "theme-color", content: "#0B0F17" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "BallaCity" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "BallaCity",
          url: "https://ballacity.com",
        }),
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const GA_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) ?? "";
const GA_INIT_SCRIPT = GA_ID
  ? `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(GA_ID)});`
  : "";

const THEME_INIT_SCRIPT = `(function(){try{var h=document.documentElement;h.classList.add('dark');h.dataset.theme='dark';h.dataset.themePref='dark';}catch(e){document.documentElement.classList.add('dark');}})();`;

const BOOT_RETRY_KEY = "openrun:boot-retry-at";
const BOOT_TIMEOUT_MS = 12_000;
/**
 * Absolute backstop, applied even while the page still looks busy. It only has
 * to bound the pathological "requests stream forever but the app never boots"
 * case, so it is deliberately generous: a cold mobile boot over a slow network
 * can legitimately run well past twenty seconds, and reloading such a page just
 * restarts the download with a *smaller* budget (see TIMEOUT below).
 */
const BOOT_HARD_TIMEOUT_MS = 60_000;
const BOOT_PROGRESS_GRACE_MS = 4_000;

/**
 * Boot watchdog. Runs as a plain inline script (NOT a React effect) because the
 * failure it recovers from is "the client entry module never loaded" — in that
 * state no app code runs at all and the pre-hydration placeholder would sit on
 * screen forever. Reloads once, then surfaces a retry panel.
 */
const BOOT_WATCHDOG_SCRIPT = `(function(){
  var K=${JSON.stringify(BOOT_RETRY_KEY)};
  var START=Date.now();
  var previousAttempt=Number((function(){try{return sessionStorage.getItem(K)||'0';}catch(e){return '0';}})());
  var TIMEOUT=previousAttempt&&START-previousAttempt<120000?8000:${BOOT_TIMEOUT_MS};
  var HARD_TIMEOUT=${BOOT_HARD_TIMEOUT_MS};
  var PROGRESS_GRACE=${BOOT_PROGRESS_GRACE_MS};
  var lastResourceCount=0;
  var lastProgressAt=START;
  var sawComplete=0;
  var RE=/dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically imported module/i;
  function read(){try{return sessionStorage.getItem(K);}catch(e){return null;}}
  function write(v){try{sessionStorage.setItem(K,v);}catch(e){}}
  function booted(){return !!window.__openrun_booted;}
  function makeFailureHtml(){
    return '<p class="text-sm font-medium text-foreground">We could not finish loading</p>'+
      '<p class="mt-2 text-sm text-muted-foreground">Check your connection, then try again.</p>'+
      '<div class="mt-5 flex flex-wrap justify-center gap-2">'+
      '<button type="button" id="boot-retry" class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</button>'+
      '<a href="/auth" class="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground">Sign in again</a>'+
      '<a href="/" class="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground">Go home</a>'+
      '</div>';
  }
  function showFailure(){
    var el=document.getElementById('boot-fallback');
    if(el){
      el.innerHTML=makeFailureHtml();
    } else {
      var overlay=document.createElement('div');
      overlay.id='boot-fallback';
      overlay.className='fixed inset-0 z-50 grid place-items-center bg-background px-4';
      overlay.innerHTML='<div class="flex max-w-sm flex-col items-center text-center">'+makeFailureHtml()+'</div>';
      document.body.appendChild(overlay);
    }
    var b=document.getElementById('boot-retry');
    if(b)b.addEventListener('click',function(){try{sessionStorage.removeItem(K);}catch(e){}window.location.reload();});
  }
  function recover(force){
    if(booted())return;
    if(!force){showFailure();return;}
    var attemptedAt=Number(read()||'0');
    if(attemptedAt&&Date.now()-attemptedAt<120000){showFailure();return;}
    write(String(Date.now()));
    window.location.reload();
  }
  function resourceCount(){try{var o=location.origin;var e=performance.getEntriesByType('resource');var n=0;for(var i=0;i<e.length;i++){if(String(e[i].name).indexOf(o)===0)n++;}return n;}catch(e){return 0;}}
  function stillFetching(){try{return document.readyState!=='complete';}catch(e){return false;}}
  function checkProgress(){
    if(booted())return;
    var now=Date.now();
    var count=resourceCount();
    // A resource entry only appears once that request COMPLETES, so a single
    // slow module in flight looks identical to a dead page. An incomplete
    // document means the browser is still fetching something: that is progress,
    // not a stall, and reloading it would just restart the download.
    var fetching=stillFetching();
    // Hydration runs after the last request lands and is CPU-bound, so it emits
    // no resources at all. Give it its own grace window instead of counting the
    // wait as time already stalled. A page that never loads reaches 'complete'
    // almost immediately, so this costs a dead page nothing.
    if(!fetching&&!sawComplete){sawComplete=1;lastProgressAt=now;}
    if(count>lastResourceCount||fetching){lastResourceCount=count;lastProgressAt=now;}
    if(now-START>=HARD_TIMEOUT){recover(true);return;}
    if(now-START>=TIMEOUT&&now-lastProgressAt>=PROGRESS_GRACE){recover(true);return;}
    setTimeout(checkProgress,1000);
  }
  function onMessage(m){if(m&&RE.test(String(m)))recover(true);}
  window.addEventListener('error',function(e){onMessage((e&&(e.message||(e.error&&e.error.message)))||'');});
  window.addEventListener('unhandledrejection',function(e){
    var r=e&&e.reason;onMessage((r&&r.message)||(typeof r==='string'?r:''));
  });
  lastResourceCount=resourceCount();
  setTimeout(checkProgress,1000);
})();`;

/** Called once the React app is running, so the watchdog stands down. */
function markAppBooted() {
  try {
    (window as unknown as { __openrun_booted?: boolean }).__openrun_booted = true;
    sessionStorage.removeItem(BOOT_RETRY_KEY);
  } catch {
    /* storage unavailable */
  }
}

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {GA_ID ? (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`} />
            <script dangerouslySetInnerHTML={{ __html: GA_INIT_SCRIPT }} />
          </>
        ) : null}
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: BOOT_WATCHDOG_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const OAUTH_PROVIDER_KEY = "openrun:oauth-provider";
const AUTH_SESSION_CHECK_TIMEOUT_MS = 5_000;
const ONBOARDING_CHECK_TIMEOUT_MS = 5_000;

/**
 * The onboarding guard runs behind `requireSupabaseAuth`, so calling it with a
 * missing OR stale access token throws "Unauthorized" on the server (which the
 * error overlay reports as a runtime error). Verify locally first, and refresh
 * an expired/near-expiry token before the RPC so callers only ever hit their
 * fallback path for genuine failures.
 */
async function fetchOnboardingStatus() {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  if (!session?.access_token) throw new Error("No Supabase session");

  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
  if (expiresAt && expiresAt - Date.now() < 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed.session ?? null;
    if (!session?.access_token) throw new Error("Supabase session expired");
  }

  return getOnboardingStatus();
}

function withDeadline<T>(operation: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error("Operation timed out")), timeoutMs);
    Promise.resolve(operation).then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

async function readSessionBounded() {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), AUTH_SESSION_CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function readSavedOAuthProvider(): "google" | "apple" | null {
  try {
    const provider = window.sessionStorage.getItem(OAUTH_PROVIDER_KEY);
    return provider === "google" || provider === "apple" ? provider : null;
  } catch {
    return null;
  }
}

function clearSavedOAuthProvider() {
  try {
    window.sessionStorage.removeItem(OAUTH_PROVIDER_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}

function isChunkLoadError(reason: unknown): boolean {
  const msg =
    (reason as { message?: string } | null | undefined)?.message ??
    (typeof reason === "string" ? reason : "");
  if (!msg) return false;
  return (
    /Importing a module script failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

function maybeReloadForStaleChunk(reason: unknown) {
  if (!isChunkLoadError(reason)) return;
  try {
    const last = Number(sessionStorage.getItem(BOOT_RETRY_KEY) ?? "0");
    if (last && Date.now() - last < 120_000) return;
    sessionStorage.setItem(BOOT_RETRY_KEY, String(Date.now()));
  } catch {
    // ignore storage errors
  }
  window.location.reload();
}

// After the app is rebuilt, a page left open keeps calling old server-action
// addresses that no longer exist, which answers with a 500 and a blank panel.
// Detect that specific answer and refresh the page once.
function installStaleServerFnRecovery() {
  if (typeof window === "undefined") return () => {};
  const originalFetch = window.fetch.bind(window);
  const patched: typeof window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (response.status === 500 && url.includes("/_serverFn/")) {
        const text = await response.clone().text();
        if (/Invalid server function ID/i.test(text)) {
          maybeReloadForStaleChunk("Loading chunk stale-server-fn failed");
        }
      }
    } catch {
      // never let the check break the request
    }
    return response;
  };
  window.fetch = patched;
  return () => {
    if (window.fetch === patched) window.fetch = originalFetch;
  };
}

const PUBLIC_ROUTES = [
  "/",
  "/auth",
  "/reset-password",
  "/.lovable/oauth/consent",
  // Legal documents must be readable before/without signing in.
  "/terms",
  "/privacy",
  "/cookies",
  // Safety Center, Trust Center, and policy pages must be readable without
  // signing in.
  "/safety",
  "/trust-center",
  "/community-guidelines",
  "/contact",
  // Sports guides are public, indexable content.
  "/guide",
  // Articles are public, indexable content.
  "/blog",


  // Shareable, sign-in-free surface.
  "/highlights",
  "/player-card",
  // A parent's private link to one family clip: opens without signing in, but is
  // unindexed, expires, and can be revoked.
  "/family-share",
  // Tryout/camp sign-up pages are shareable; applying still requires sign-in.
  "/tryouts",
];
const TAB_PATHS = [
  "/feed",
  "/players",
  "/teams",
  "/create",
  "/discover",
  "/profile",
  "/notifications",
  "/reels",
  "/highlights",
];

/**
 * Same-origin, safe next-path filter used by both the auth redirect
 * (to preserve the user's destination) and the /auth page (to bounce
 * back after sign-in). Rejects anything that could loop back through
 * the sign-in flow itself.
 */
export function sanitizeNextPath(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  if (!raw.startsWith("/") || raw.startsWith("//")) return undefined;
  const pathOnly = raw.split(/[?#]/)[0] ?? "";
  if (pathOnly === "/") return undefined;
  if (pathOnly === "/auth" || pathOnly.startsWith("/auth/")) return undefined;
  if (pathOnly === "/reset-password" || pathOnly.startsWith("/reset-password/")) return undefined;
  return raw;
}

function AuthLoadingFallback({ pending }: { pending: boolean }) {
  const [showRetry, setShowRetry] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setShowRetry(true), 6000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">
          {pending ? "Signing you in…" : "Loading your account…"}
        </p>
        {showRetry ? (
          <div className="mt-6 w-full">
            <p className="text-sm text-muted-foreground">
              This is taking longer than expected. Check your connection and try again.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => {
                  setReloading(true);
                  window.location.reload();
                }}
                disabled={reloading}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {reloading ? "Reloading…" : "Try again"}
              </button>
              <a
                href="/auth"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Sign in again
              </a>
              <a
                href="/"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Go home
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * User ids already confirmed to have completed onboarding in this tab.
 * Keeps route changes from re-running the guard (and re-showing the loader).
 */
const onboardedUsers = new Set<string>();

/** User ids whose age has already been determined server-side in this tab. */
const ageVerifiedUsers = new Set<string>();

function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const { user, loading } = useAuth();
  const isPublic =
    pathname === "/" ||
    PUBLIC_ROUTES.some((p) => p !== "/" && (pathname === p || pathname.startsWith(`${p}/`)));
  const isTab = TAB_PATHS.includes(pathname);
  // Second-chance verification: on mobile Safari/Chrome the Supabase session
  // can hydrate one tick after `loading` flips to false. Redirecting to
  // /auth on that first tick would strand refreshed protected pages. We
  // re-check `getSession()` once before giving up.
  const [verifying, setVerifying] = useState(false);
  useNotificationPush();
  useOneSignal();
  // Guardian ⇄ managed-child switching: reload tabs whose identity changed,
  // and restore a parked guardian if the child's session disappears.
  useManagedSessionWatcher();
  // Delivers due pre-game reminders for the signed-in player.
  useGameReminderFlush();

  // Let push/notification handlers route in-app instead of reloading the page.

  useEffect(() => {
    setDeepLinkNavigator((path) => {
      void router.navigate({ href: path } as any);
      if (typeof window !== "undefined") window.focus();
    });
    return () => setDeepLinkNavigator(null);
  }, [router]);

  useEffect(() => {
    if (loading) {
      logAuthGateDecision("verify-start", {
        pathname,
        loading,
        hasUser: !!user,
        extra: { phase: "waiting-for-useAuth" },
      });
      return;
    }
    if (user) {
      logAuthGateDecision("user-present", { pathname, loading, hasUser: true });
      setVerifying(false);
      return;
    }
    if (isPublic) {
      logAuthGateDecision("public-skip", { pathname, loading, hasUser: false });
      return;
    }
    if (pathname === "/auth") {
      logAuthGateDecision("auth-route-skip", { pathname, loading, hasUser: false });
      return;
    }

    let cancelled = false;
    setVerifying(true);
    logAuthGateDecision("verify-start", {
      pathname,
      loading,
      hasUser: false,
      extra: { phase: "second-chance-getSession" },
    });
    const t0 = performance.now();
    const attemptRedirect = async () => {
      const first = await readSessionBounded();
      if (cancelled) return;
      if (first?.data.session?.user) {
        logAuthGateDecision("verify-hydrated-late", {
          pathname,
          loading,
          hasUser: true,
          extra: {
            durationMs: Math.round(performance.now() - t0),
            userId: first.data.session.user.id,
          },
        });
        setVerifying(false);
        return;
      }

      // If localStorage still holds a non-expired Supabase session, the
      // client just hasn't finished parsing it yet (common on hard refresh
      // in mobile webviews and cold SSR shells). NEVER redirect in that
      // window — sit on the loading fallback and let the root's
      // onAuthStateChange listener flip `useAuth` to signed-in. A stray
      // redirect here bounces refreshed protected pages to /auth for no
      // reason. As a safety net, re-check `getSession()` once more after
      // ~4s in case onAuthStateChange never fires.
      const stored = readStoredSupabaseSession();
      if (stored) {
        logAuthGateDecision("verify-waiting-hydration", {
          pathname,
          loading,
          hasUser: false,
          extra: { storedExpiresAt: stored.expiresAt },
        });
        await new Promise((r) => setTimeout(r, 4000));
        if (cancelled) return;
        const final = await readSessionBounded();
        if (cancelled) return;
        if (final?.data.session?.user) {
          logAuthGateDecision("verify-hydrated-late", {
            pathname,
            loading,
            hasUser: true,
            extra: {
              durationMs: Math.round(performance.now() - t0),
              userId: final.data.session.user.id,
              retried: true,
            },
          });
          setVerifying(false);
          return;
        }
        // Still no session after both bounded checks. Even if stale storage
        // remains, fall through to sign-in rather than holding the full-screen
        // loader forever.
        if (readStoredSupabaseSession()) {
          logAuthGateDecision("verify-waiting-hydration", {
            pathname,
            loading,
            hasUser: false,
            extra: { phase: "timed-out-after-final-check" },
          });
        }
      }

      const durationMs = Math.round(performance.now() - t0);
      logAuthGateDecision("verify-no-session", {
        pathname,
        loading,
        hasUser: false,
        extra: {
          durationMs,
          errorName: first?.error?.name ?? null,
          errorMessage: first?.error?.message ?? null,
        },
      });
      const href = router.state.location.href;
      const safeNext = sanitizeNextPath(href);
      logAuthGateDecision("redirect", {
        pathname,
        loading,
        hasUser: false,
        extra: { to: "/auth", next: safeNext ?? null, durationMs },
      });
      // The redirect must survive a router rejection (e.g. a competing
      // navigate from the page we're leaving). Never leave `verifying` true —
      // that holds the full-screen loader forever.
      try {
        router.navigate({
          to: "/auth",
          search: safeNext ? { next: safeNext } : {},
          replace: true,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setVerifying(false);
      }
      // Hard fallback: if we're somehow still on the protected URL a moment
      // later, leave via the browser so the user is never stranded.
      window.setTimeout(() => {
        if (cancelled) return;
        if (typeof window === "undefined") return;
        if (window.location.pathname === "/auth") return;
        const q = safeNext ? `?next=${encodeURIComponent(safeNext)}` : "";
        window.location.replace(`/auth${q}`);
      }, 700);
    };
    void attemptRedirect();
    return () => {
      cancelled = true;
    };
  }, [loading, user, isPublic, router, pathname]);

  // Age-verification gate: no authenticated member reaches ordinary
  // onboarding, the feed, or any protected route until the SERVER has
  // determined their age from a stored date of birth. `isAccountSetupEscape`
  // lists the only exits (the age form itself, the guardian-consent flow, and
  // legal / safety reading), so the gate can never trap anyone in a loop.
  const skipAgeCheck = isPublic || isAccountSetupEscape(pathname);

  const [ageStatus, setAgeStatus] = useState<"unknown" | "ok" | "missing">(
    !!user && ageVerifiedUsers.has(user.id) ? "ok" : "unknown",
  );

  useEffect(() => {
    if (loading || !user) return;
    if (skipAgeCheck || ageVerifiedUsers.has(user.id)) {
      setAgeStatus("ok");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const status = await withDeadline(getMyAgeStatus(), ONBOARDING_CHECK_TIMEOUT_MS);
        if (cancelled) return;
        if (needsAgeGate(status.status) || status.cohort === "unknown") {
          // Render the date-of-birth step in place instead of redirecting to a
          // URL that may never resolve — the member finishes setup right here
          // and continues on the route they asked for.
          setAgeStatus("missing");
        } else {
          ageVerifiedUsers.add(user.id);
          setAgeStatus("ok");
        }
      } catch {
        // Network/server fault: don't strand the member behind a loader. Every
        // age-restricted action is refused server-side anyway.
        if (cancelled) return;
        setAgeStatus("ok");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, skipAgeCheck, router]);

  // Onboarding completion guard: block rendering of protected routes until we
  // confirm the user has picked an account type. Fresh Google sign-ins would
  // otherwise flash the feed for a moment before the redirect fires.
  //
  // The result is cached per user id for the lifetime of the tab, so ordinary
  // navigations never re-run the check (which used to blank the screen with
  // the full-page loader on every route change).
  // The account-setup escapes (date-of-birth form, guardian consent, parent
  // center, legal/safety reading) belong to the age step. The type check must
  // be skipped on ALL of them, not only on the picker itself — otherwise it
  // redirects away from the date-of-birth screen while the age gate redirects
  // back, and the two guards ping-pong forever.
  const skipTypeCheck = isPublic || pathname === "/onboarding/account-type" || skipAgeCheck;

  const alreadyConfirmed = !!user && onboardedUsers.has(user.id);
  const [typeStatus, setTypeStatus] = useState<"unknown" | "ok" | "missing">(
    alreadyConfirmed ? "ok" : "unknown",
  );
  // Bumped after a failed check so the effect re-runs without blanking the page.
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (loading || !user) return;
    // Age determination strictly precedes the account-type picker, so an
    // unverified member is never routed into ordinary onboarding.
    if (!skipAgeCheck && ageStatus !== "ok") return;
    if (skipTypeCheck || onboardedUsers.has(user.id)) {
      setTypeStatus("ok");
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;
    // A background retry must not blank an already-rendered page.
    setTypeStatus((s) => (s === "ok" ? "ok" : "unknown"));
    (async () => {
      // Authoritative server-side guard: inspects auth identities via admin
      // so a social user with stripped provider metadata is still classified
      // correctly. Falls back to the client query if the server fn fails.
      try {
        const status = await withDeadline(fetchOnboardingStatus(), ONBOARDING_CHECK_TIMEOUT_MS);
        if (cancelled) return;
        if (status.needsOnboarding) {
          // Render the picker in place; no redirect.
          setTypeStatus("missing");
        } else {
          onboardedUsers.add(user.id);
          setTypeStatus("ok");
        }
        return;
      } catch {
        /* fall through to client check */
      }
      try {
        const { data, error } = await withDeadline(
          supabase.from("profiles").select("account_type").eq("id", user.id).maybeSingle(),
          ONBOARDING_CHECK_TIMEOUT_MS,
        );
        if (cancelled) return;
        if (error) throw error;
        const t = (data as { account_type?: string } | null)?.account_type;
        if (isAccountType(t)) {
          onboardedUsers.add(user.id);
          setTypeStatus("ok");
        } else {
          setTypeStatus("missing");
        }
      } catch {
        // Both the server guard and the profile read failed (offline, server
        // restart). Don't hold the page behind the loader on a network fault —
        // render what the user asked for and re-check in the background.
        // `onboardedUsers` stays untouched so the retry is a real re-check.
        if (cancelled) return;
        setTypeStatus("ok");
        retryTimer = window.setTimeout(() => setRetryTick((n) => n + 1), 5000);
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
    // Intentionally NOT keyed on `pathname`: the check is per user, not per route.
  }, [user, loading, skipTypeCheck, skipAgeCheck, ageStatus, router, retryTick]);

  useEffect(() => {
    if (user && !isTab) {
      document.body.style.paddingBottom = "calc(env(safe-area-inset-bottom) + 6rem)";
    } else {
      document.body.style.paddingBottom = "";
    }
    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [user, isPublic, isTab]);

  // Public routes skip the sign-in/age/account-type gates below so an
  // anonymous visitor (e.g. a shared link) can view them. A signed-in viewer
  // still gets the tab bar there: a page like /safety or /terms otherwise has
  // no way back into the app except the browser's own back button, which an
  // installed PWA does not show.
  if (isPublic) {
    return (
      <>
        <ManagedSessionBanner />
        {children}
        {user && <BottomNav />}
      </>
    );
  }
  // "Signing you in…" only while an OAuth attempt is actually pending.
  const oauthPending = typeof window !== "undefined" && !!readSavedOAuthProvider();
  if (loading || verifying || !user) {
    return <AuthLoadingFallback pending={oauthPending} />;
  }
  // Age comes before every other onboarding step. While the check is still in
  // flight we show the loader; once we know a date of birth is missing we
  // render the real setup step right here — no redirect, so the member can
  // finish and stay on the route they asked for.
  if (!skipAgeCheck && ageStatus === "missing") {
    return (
      <AgeGateScreen
        onResolved={(cohort) => {
          if (requiresParentalConsent(parseCohort(cohort))) {
            router.navigate({ to: CHILD_CONSENT_ROUTE, replace: true } as never);
            return;
          }
          if (user) ageVerifiedUsers.add(user.id);
          setAgeStatus("ok");
        }}
      />
    );
  }
  if (!skipAgeCheck && ageStatus !== "ok") {
    return <AuthLoadingFallback pending={oauthPending} />;
  }
  // Same for the profile-type step: render the picker in place.
  if (!skipTypeCheck && typeStatus === "missing") {
    // The setup they chose decides where they go — for every role, Player
    // included — and there is no question in between. `onAlreadySet` passes none.
    const finishType = (_type?: AccountType, setup?: SetupId) => {
      if (user) onboardedUsers.add(user.id);
      setTypeStatus("ok");
      if (setup) router.navigate({ ...routeForSetup(setup), replace: true } as never);
    };
    return <AccountTypeScreen onResolved={finishType} onAlreadySet={() => finishType()} />;
  }
  // Hold rendering only on a genuine first check for this user; a cached
  // "ok" keeps the page mounted across navigations.
  if (!skipTypeCheck && typeStatus !== "ok") {
    return <AuthLoadingFallback pending={oauthPending} />;
  }

  return (
    <>
      <ManagedSessionBanner />
      {children}
      <BottomNav />
      <PwaInstallPrompt />
    </>
  );
}

/**
 * Time-on-platform heartbeat (duration only). Rendered client-only so it never
 * runs during SSR.
 */
function SessionHeartbeat() {
  useSessionHeartbeat();
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    markAppBooted();
    const onError = (event: ErrorEvent) => maybeReloadForStaleChunk(event.error ?? event.message);

    const onRejection = (event: PromiseRejectionEvent) => maybeReloadForStaleChunk(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    const uninstallStaleServerFnRecovery = installStaleServerFnRecovery();

    // Record initial URL, then every resolved navigation, so a later visit
    // to `/` (refresh, bookmark, OAuth return) can restore the page.
    rememberLastVisited(router.state.location.href);
    const unsubRouter = router.subscribe("onResolved", () => {
      rememberLastVisited(router.state.location.href);
    });

    // Run once on mount for already-signed-in users.
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) runLegacyHostMigration(data.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Only react to identity transitions. TOKEN_REFRESHED / INITIAL_SESSION
      // fire on every mount and every ~hour of tab focus — invalidating on
      // those thrashes the router and can 401-storm protected queries.
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") {
        return;
      }
      router.invalidate();
      if (event !== "SIGNED_OUT") {
        queryClient.invalidateQueries();
      } else {
        // Don't leak the previous user's history into the next session.
        clearLastVisited();
      }
      if ((event === "SIGNED_IN" || event === "USER_UPDATED") && session?.user) {
        runLegacyHostMigration(session.user.id);
        // Consume the OAuth `next` stashed by the sign-in button (kept out
        // of `redirect_uri` because it must stay a public same-origin URL).
        const consumeSavedNext = () => {
          let saved: string | null = null;
          try {
            saved = window.sessionStorage.getItem("openrun:oauth-next");
            if (saved) window.sessionStorage.removeItem("openrun:oauth-next");
          } catch {
            /* sessionStorage unavailable */
          }
          const dest = sanitizeNextPath(saved);
          if (dest && dest !== router.state.location.pathname) {
            router.navigate({ to: dest, replace: true });
          }
        };
        // Reconcile account_type after any sign-in (Google, Apple, email).
        // If the user picked a type before OAuth we persist it; otherwise if
        // the profile still has no account_type we route to the onboarding
        // picker so social sign-ins can never land on the feed as a default.
        const pending = readPendingAccountType();
        const uid = session.user.id;
        const clientProvider = session.user.app_metadata?.provider;
        const savedProvider = readSavedOAuthProvider();
        const clientIsOAuth =
          clientProvider === "google" || clientProvider === "apple" || !!savedProvider;
        // Backend guard: authoritative check via getOnboardingStatus. Even if
        // provider metadata was stripped from the session, the server inspects
        // linked identities and can still classify the user as social.
        void fetchOnboardingStatus()
          .then((status) => {
            const isOAuth = clientIsOAuth || status.isSocial;
            if (!status.needsOnboarding) {
              if (pending) clearPendingAccountType();
              if (isOAuth) clearSavedOAuthProvider();
              consumeSavedNext();
              return;
            }
            // New Google/Apple sign-ins must always go through the picker —
            // never auto-apply a stashed pending choice.
            if (isOAuth) {
              if (router.state.location.pathname !== "/onboarding/account-type") {
                router.navigate({ to: "/onboarding/account-type", replace: true });
              }
              return;
            }
            if (pending) {
              void supabase
                .from("profiles")
                .update({ account_type: pending })
                .eq("id", uid)
                .then(() => {
                  clearPendingAccountType();
                  clearSavedOAuthProvider();
                  router.invalidate();
                  consumeSavedNext();
                });
              return;
            }
            if (router.state.location.pathname !== "/onboarding/account-type") {
              router.navigate({ to: "/onboarding/account-type", replace: true });
            }
          })
          .catch(() => {
            // Server guard unavailable: fall back to forcing the picker for any
            // signed-in user without a persisted account type.
            if (clientIsOAuth && router.state.location.pathname !== "/onboarding/account-type") {
              router.navigate({ to: "/onboarding/account-type", replace: true });
            }
          });
      }
    });
    return () => {
      sub.subscription.unsubscribe();
      unsubRouter();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      uninstallStaleServerFnRecovery();
    };
  }, [queryClient, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <ClientOnly
        fallback={
          <div className="grid min-h-dvh place-items-center bg-background px-4">
            <div
              className="flex max-w-sm flex-col items-center text-center"
              role="status"
              aria-live="polite"
            >
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
              <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
            </div>
          </div>
        }
      >
        <GlobalErrorBoundary scope="root">
          <AuthGate>
            <SwipeNavigator>
              <Outlet />
            </SwipeNavigator>
          </AuthGate>
        </GlobalErrorBoundary>
      </ClientOnly>
      <Toaster position="top-center" richColors />
      <ClientOnly fallback={null}>
        <SessionHeartbeat />
        <DebugModeToggle />
      </ClientOnly>
    </QueryClientProvider>
  );
}
