import { QueryClient } from "@tanstack/react-query";
import { createRouter, isNotFound, isRedirect } from "@tanstack/react-router";
import { isAuthRefusal, isValidationError } from "@/lib/error-report";
import { reportBrowserError } from "@/lib/error-report-client";
import { routeTree } from "./routeTree.gen";

/**
 * P0-8: every route error screen (the root's errorComponent and each route's) reports what it
 * caught, as GlobalErrorBoundary does for the app shell. The router calls this from the route's
 * catch boundary; reportBrowserError sends a given error at most once per page, so an error both
 * boundaries see is still one report. Redirects and notFound are navigation, not failures; bad
 * input (a loader's server function refusing a malformed id) and auth refusals are answers, which
 * the server-function reporter skips by the same rules.
 */
function reportRouteError(error: unknown): void {
  if (isRedirect(error) || isNotFound(error)) return;
  if (isValidationError(error) || isAuthRefusal(error)) return;
  reportBrowserError(error, "boundary");
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultOnCatch: reportRouteError,
  });

  return router;
};
