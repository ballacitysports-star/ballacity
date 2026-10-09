import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { RouteFallback, FALLBACK_ACTION_CLASS } from "@/components/layout/RouteFallback";
import { pageHead } from "@/lib/seo";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type AuthorizationDetails = {
  client?: { name?: string; client_name?: string; redirect_uri?: string } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
  scope?: string | null;
  scopes?: string[] | null;
};

type OAuthNs = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  denyAuthorization: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
};

/**
 * The Supabase OAuth namespace, read at call time.
 *
 * Deliberately not a module-level helper: the route splitter puts `loader` and
 * `component` in separate chunks, and a shared local function referenced from
 * both is not re-exported from the shared chunk, which breaks the dev module
 * graph. Each call site resolves the namespace itself instead.
 */
type WithOAuth = { oauth: OAuthNs };

export const Route = createFileRoute("/.lovable/oauth/consent")({
  head: () =>
    pageHead({
      title: "Authorize access — BallaCity",
      description: "Review and approve access for a connected application.",
      noindex: true,
    }),
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } as never });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const oauth = (supabase.auth as unknown as WithOAuth).oauth;
    const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <RouteFallback
      title="Could not load this authorization request"
      message={String((error as Error)?.message ?? error)}
      action={
        <Link to="/" className={FALLBACK_ACTION_CLASS}>
          Go home
        </Link>
      }
    />
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientName = details?.client?.name ?? details?.client?.client_name ?? "an app";
  const redirectUri = details?.client?.redirect_uri;
  const scopes =
    details?.scopes ?? (details?.scope ? details.scope.split(/\s+/).filter(Boolean) : []);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const oauth = (supabase.auth as unknown as WithOAuth).oauth;
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="page-shell-narrow py-6">
      <h1 className="page-title">Connect {clientName} to your BallaCity account</h1>
      <p className="mt-3 page-subtitle">
        This lets {clientName} use BallaCity as you. It does not bypass BallaCity's permissions or
        backend policies.
      </p>
      {redirectUri && (
        <p className="mt-2 break-all text-xs text-muted-foreground">Redirects to: {redirectUri}</p>
      )}
      {scopes.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {scopes.map((s: string) => (
            <li key={s} className="rounded-md border border-border bg-surface px-3 py-2">
              {s === "openid" || s === "profile"
                ? "Share your basic profile"
                : s === "email"
                  ? "Share your email address"
                  : `Additional permission: ${s}`}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => decide(true)}
          disabled={busy}
          className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => decide(false)}
          disabled={busy}
          className="flex-1 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </main>
  );
}
