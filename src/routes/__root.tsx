import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import { DebugModeToggle } from "@/components/DebugModeToggle";
import { ClientOnly } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { runLegacyHostMigration } from "@/lib/legacy-host-migration";
import { useAuth } from "@/hooks/use-auth";
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
    <html lang="en" className="dark">
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

const PUBLIC_ROUTES = ["/", "/auth", "/reset-password"];

function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const { user, loading } = useAuth();
  const isPublic = pathname === "/" || PUBLIC_ROUTES.some((p) => p !== "/" && (pathname === p || pathname.startsWith(`${p}/`)));
  useNotificationPush();
  useOneSignal();


  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) {
      router.navigate({ to: "/auth", replace: true });
    }
  }, [loading, user, isPublic, router, pathname]);



  if (isPublic) return <>{children}</>;
  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }
  return <>{children}</>;
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

