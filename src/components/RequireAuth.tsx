import { useEffect, type ComponentType } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { AuthRedirectSkeleton } from "@/components/AuthRedirectSkeleton";

/**
 * UX gate for pages that only make sense signed in. Anonymous visitors are
 * sent to /auth and returned via `next`. This is not an authorization
 * boundary: RLS and RPCs remain the enforcement point.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { pathname, searchStr } = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      navigate({
        to: "/auth",
        search: { next: `${pathname}${searchStr}` } as any,
        replace: true,
      });
    }
  }, [loading, user, navigate, pathname, searchStr]);

  if (loading || !user) return <AuthRedirectSkeleton label="Sign in to continue…" />;
  return <>{children}</>;
}

export function withRequireAuth<P extends object>(Component: ComponentType<P>) {
  function Guarded(props: P) {
    return (
      <RequireAuth>
        <Component {...props} />
      </RequireAuth>
    );
  }
  Guarded.displayName = `withRequireAuth(${Component.displayName ?? Component.name ?? "Component"})`;
  return Guarded;
}
