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
import { FloatingNotificationsButton } from "@/components/FloatingNotificationsButton";
import { ClientOnly } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { runLegacyHostMigration } from "@/lib/legacy-host-migration";
import { useAuth } from "@/hooks/use-auth";
import { savePostAuthRedirect } from "@/lib/post-auth-redirect";
import { useNotificationPush } from "@/lib/notifications";
import { useOneSignal } from "@/lib/onesignal";


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
      { name: "description", content: "Find and host pickup sports games near you. Basketball, soccer, pickleball, tennis and more — join a game in seconds." },
      { name: "author", content: "OpenRun" },
      { property: "og:title", content: "OpenRun — Pickup sports, on demand" },
      { property: "og:description", content: "Find and host pickup sports games near you in seconds." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('openrun:theme');var c=t==='light'?'light':'dark';var h=document.documentElement;h.classList.add(c);h.dataset.theme=c;}catch(e){document.documentElement.classList.add('dark');}})();`;

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <HeadContent />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const CHUNK_RELOAD_KEY = "__openrun_chunk_reloaded_at";

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

const AUTH_ONLY_ROUTES = ["/auth", "/oauth/callback", "/reset-password"];
const ONBOARDING_ROUTE = "/onboarding";
const TAB_PATHS = ["/feed", "/players", "/teams", "/create", "/discover", "/profile", "/notifications", "/reels"];

// Routes that require sign-in. Everything else is publicly viewable.
// Signed-out visitors who try a protected path get bounced to /auth and
// returned after login via savePostAuthRedirect.
const PROTECTED_PREFIXES = [
  "/account",
  "/admin",
  "/checkout",
  "/messages",
  "/payments",
  "/settings",
  "/onboarding",
  "/notifications",
  "/create",
  "/profile/edit",
  "/review/new",
];
function isProtectedPath(pathname: string): boolean {
  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  if (/^\/teams\/create$/.test(pathname)) return true;
  if (/^\/teams\/[^/]+\/edit$/.test(pathname)) return true;
  if (/^\/games\/[^/]+\/(pay|payment-setup)$/.test(pathname)) return true;
  return false;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const { user, loading } = useAuth();
  const isAuthOnly = AUTH_ONLY_ROUTES.includes(pathname);
  const isProtected = isProtectedPath(pathname);
  const isPublic = !isProtected && !isAuthOnly;
  const isTab = TAB_PATHS.includes(pathname);
  useNotificationPush();
  useOneSignal();

  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user && isProtected) {
      // Preserve the URL (pathname + search) so we can restore it after auth.
      const search = router.state.location.searchStr ?? "";
      savePostAuthRedirect(`${pathname}${search}`);
      router.navigate({ to: "/auth", replace: true });
      return;
    }
  }, [loading, user, isProtected, isAuthOnly, router, pathname, needsOnboarding]);

  // Detect whether the signed-in user has completed onboarding (username set).
  useEffect(() => {
    if (!user) {
      setNeedsOnboarding(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setNeedsOnboarding(!data?.username);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Redirect to onboarding only when a signed-in user without a username
  // tries to access a protected route. Public browsing is unrestricted.
  useEffect(() => {
    if (!user || needsOnboarding !== true) return;
    if (!isProtected) return;
    if (pathname === ONBOARDING_ROUTE) return;
    router.navigate({ to: ONBOARDING_ROUTE, replace: true });
  }, [user, needsOnboarding, pathname, router, isProtected]);

  useEffect(() => {
    if (user && !isTab && !isAuthOnly) {
      document.body.style.paddingBottom = "calc(env(safe-area-inset-bottom) + 6rem)";
    } else {
      document.body.style.paddingBottom = "";
    }
    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [user, isTab, isAuthOnly]);

  // Signed-out visitors: render public content freely; auth pages render as-is.
  // Protected paths are handled by the redirect effect above; show a spinner
  // while we're still resolving auth to avoid flashing a redirect.
  if (!user) {
    if (isPublic || isAuthOnly) return <>{children}</>;
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }
  if (pathname === ONBOARDING_ROUTE || isAuthOnly) return <>{children}</>;
  return (
    <>
      {children}
      <FloatingNotificationsButton />
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

    // Run once on mount for already-signed-in users.
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) runLegacyHostMigration(data.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      queryClient.invalidateQueries();
      router.invalidate();
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
        runLegacyHostMigration(session.user.id);
      }
    });
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [queryClient, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <Outlet />
      </AuthGate>
      <Toaster position="top-center" richColors />
      <ClientOnly fallback={null}>
        <DebugModeToggle />
      </ClientOnly>
    </QueryClientProvider>
  );
}

