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
import { DebugModeToggle } from "@/components/DebugModeToggle";
import { BottomNav } from "@/components/BottomNav";
import { ClientOnly } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { runLegacyHostMigration } from "@/lib/legacy-host-migration";
import { useAuth } from "@/hooks/use-auth";
import { useNotificationPush } from "@/lib/notifications";
import { useOneSignal } from "@/lib/onesignal";
import { logAuthGateDecision, readStoredSupabaseSession } from "@/lib/authgate-log";
import { clearLastVisited, rememberLastVisited } from "@/lib/last-visited";
import {
  clearPendingAccountType,
  isAccountType,
  readPendingAccountType,
} from "@/lib/account-type";
import { getOnboardingStatus } from "@/lib/onboarding.functions";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "OpenRun — Pickup sports, on demand" },
      {
        name: "description",
        content:
          "Find and host pickup sports games near you. Basketball, soccer, pickleball, tennis and more — join a game in seconds.",
      },
      { name: "author", content: "OpenRun" },
      { property: "og:title", content: "OpenRun — Pickup sports, on demand" },
      {
        property: "og:description",
        content: "Find and host pickup sports games near you in seconds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const THEME_INIT_SCRIPT = `(function(){try{var h=document.documentElement;h.classList.add('dark');h.dataset.theme='dark';h.dataset.themePref='dark';}catch(e){document.documentElement.classList.add('dark');}})();`;

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const CHUNK_RELOAD_KEY = "__openrun_chunk_reloaded_at";
const OAUTH_PROVIDER_KEY = "openrun:oauth-provider";

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
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? "0");
    if (Date.now() - last < 10_000) return; // avoid reload loops
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // ignore storage errors
  }
  window.location.reload();
}

const PUBLIC_ROUTES = ["/", "/auth", "/reset-password", "/.lovable/oauth/consent"];
const TAB_PATHS = [
  "/feed",
  "/players",
  "/teams",
  "/create",
  "/discover",
  "/profile",
  "/notifications",
  "/reels",
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

  useEffect(() => {
    if (loading) {
      logAuthGateDecision("verify-start", { pathname, loading, hasUser: !!user, extra: { phase: "waiting-for-useAuth" } });
      return;
    }
    if (user) {
      logAuthGateDecision("user-present", { pathname, loading, hasUser: true });
      if (verifying) setVerifying(false);
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
      const first = await supabase.auth.getSession();
      if (cancelled) return;
      if (first.data.session?.user) {
        logAuthGateDecision("verify-hydrated-late", {
          pathname,
          loading,
          hasUser: true,
          extra: { durationMs: Math.round(performance.now() - t0), userId: first.data.session.user.id },
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
        const final = await supabase.auth.getSession();
        if (cancelled) return;
        if (final.data.session?.user) {
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
        // Still no session and the stored token is either gone or expired:
        // fall through to the redirect below.
        if (readStoredSupabaseSession()) {
          // Token is still present and valid — keep waiting rather than
          // redirecting. `verifying` stays true so the loader keeps
          // showing until onAuthStateChange fires (or the user reloads).
          logAuthGateDecision("verify-waiting-hydration", {
            pathname,
            loading,
            hasUser: false,
            extra: { phase: "still-waiting-after-timeout" },
          });
          return;
        }
      }

      const durationMs = Math.round(performance.now() - t0);
      logAuthGateDecision("verify-no-session", {
        pathname,
        loading,
        hasUser: false,
        extra: {
          durationMs,
          errorName: first.error?.name ?? null,
          errorMessage: first.error?.message ?? null,
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
      router.navigate({
        to: "/auth",
        search: safeNext ? { next: safeNext } : {},
        replace: true,
      });
      setVerifying(false);
    };
    void attemptRedirect();
    return () => {
      cancelled = true;
    };
  }, [loading, user, isPublic, router, pathname, verifying]);

  // Onboarding completion guard: block rendering of protected routes until we
  // confirm the user has picked an account type. Fresh Google sign-ins would
  // otherwise flash the feed for a moment before the redirect fires.
  const [typeStatus, setTypeStatus] = useState<"unknown" | "ok" | "missing">("unknown");
  const skipTypeCheck =
    isPublic || pathname === "/onboarding/account-type";

  useEffect(() => {
    if (loading || !user) return;
    if (skipTypeCheck) {
      setTypeStatus("ok");
      return;
    }
    let cancelled = false;
    setTypeStatus("unknown");
    (async () => {
      // Authoritative server-side guard: inspects auth identities via admin
      // so a social user with stripped provider metadata is still classified
      // correctly. Falls back to the client query if the server fn fails.
      try {
        const status = await getOnboardingStatus();
        if (cancelled) return;
        if (status.needsOnboarding) {
          setTypeStatus("missing");
          router.navigate({ to: "/onboarding/account-type", replace: true });
        } else {
          setTypeStatus("ok");
        }
        return;
      } catch {
        /* fall through to client check */
      }
      const { data } = await supabase
        .from("profiles")
        .select("account_type")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const t = (data as { account_type?: string } | null)?.account_type;
      if (isAccountType(t)) {
        setTypeStatus("ok");
      } else {
        setTypeStatus("missing");
        router.navigate({ to: "/onboarding/account-type", replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, skipTypeCheck, pathname, router]);

  useEffect(() => {
    if (user && !isPublic && !isTab) {
      document.body.style.paddingBottom = "calc(env(safe-area-inset-bottom) + 6rem)";
    } else {
      document.body.style.paddingBottom = "";
    }
    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [user, isPublic, isTab]);

  if (isPublic) return <>{children}</>;
  if (loading || verifying || !user) {
    return <AuthLoadingFallback pending={loading || verifying} />;
  }
  // Hold rendering until the account-type check completes (or redirects).
  if (!skipTypeCheck && typeStatus !== "ok") {
    return <AuthLoadingFallback pending={true} />;
  }
  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const onError = (event: ErrorEvent) => maybeReloadForStaleChunk(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => maybeReloadForStaleChunk(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

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
        const provider = session.user.app_metadata?.provider;
        const savedProvider = readSavedOAuthProvider();
        const isOAuth = provider === "google" || provider === "apple" || !!savedProvider;
        void supabase
          .from("profiles")
          .select("account_type")
          .eq("id", uid)
          .maybeSingle()
          .then(({ data }) => {
            const existing = (data as { account_type?: string } | null)?.account_type;
            if (isAccountType(existing)) {
              if (pending) clearPendingAccountType();
              if (isOAuth) clearSavedOAuthProvider();
              consumeSavedNext();
              return;
            }
            // New Google/Apple sign-ins must always go through the account
            // type picker — never auto-apply a stashed pending choice.
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
            // No pending choice and no stored type → force the picker.
            // The saved next stays in sessionStorage; onboarding consumes it
            // after the user picks a type.
            if (router.state.location.pathname !== "/onboarding/account-type") {
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
    };
  }, [queryClient, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <ClientOnly
        fallback={
          <div className="grid min-h-dvh place-items-center bg-background">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        }
      >
        <AuthGate>
          <Outlet />
        </AuthGate>
      </ClientOnly>
      <Toaster position="top-center" richColors />
      <ClientOnly fallback={null}>
        <DebugModeToggle />
      </ClientOnly>
    </QueryClientProvider>
  );
}
