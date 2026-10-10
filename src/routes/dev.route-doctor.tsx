import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, RotateCcw, Search, Trash2, XCircle } from "lucide-react";

import {
  clearNotFoundLog,
  diagnosePath,
  isLayoutOnlyId,
  readNotFoundLog,
  type NotFoundEntry,
} from "@/lib/route-doctor";

export const Route = createFileRoute("/dev/route-doctor")({
  head: () =>
    pageHead({
      path: "/dev/route-doctor",
      title: "Route Doctor — BallaCity",
      description:
        "Reproduce broken links, test any path against the app's routes, and see recent 404s.",
      noindex: true,
    }),
  component: RouteDoctorPage,
});

function RouteDoctorPage() {
  const router = useRouter();
  const [path, setPath] = useState("");
  const [log, setLog] = useState<NotFoundEntry[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setLog(readNotFoundLog());
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("path");
    if (initial) setPath(initial);
  }, []);

  const routes = useMemo(() => {
    const all = Object.values(router.routesById ?? {}) as {
      id: string;
      fullPath?: string;
    }[];
    return all
      .filter((r) => typeof r.fullPath === "string" && r.fullPath.length > 0)
      .map((r) => ({ routeId: r.id, pattern: r.fullPath as string }))
      .filter((r) => !r.pattern.startsWith("/api"))
      .sort((a, b) => a.pattern.localeCompare(b.pattern));
  }, [router]);

  const result = useMemo(() => (path.trim() ? diagnosePath(path, routes) : null), [path, routes]);

  const visibleRoutes = useMemo(
    () =>
      filter.trim()
        ? routes.filter((r) => r.pattern.toLowerCase().includes(filter.trim().toLowerCase()))
        : routes,
    [routes, filter],
  );

  return (
    <div className="min-h-dvh bg-background px-4 pb-24 pt-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.history.back()}
            className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="page-title">Route Doctor</h1>
            <p className="page-subtitle">
              Reproduce 404s, test any path, and find the route that should have matched.
            </p>
          </div>
        </div>

        {/* Path tester */}
        <section className="mt-6 rounded-xl border border-border bg-surface p-4">
          <label htmlFor="rd-path" className="text-sm font-medium text-foreground">
            Test a path
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="rd-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/players/123"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary"
            />
            <a
              href={path.startsWith("/") ? path : `/${path}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
            >
              <Search className="h-4 w-4" /> Open
            </a>
          </div>

          {result && (
            <div className="mt-4">
              {result.matched ? (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> Matches a route
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    pattern: {result.pattern}
                  </p>
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    routeId: {result.routeId}
                  </p>
                  {result.params && Object.keys(result.params).length > 0 && (
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      params: {JSON.stringify(result.params)}
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <XCircle className="h-4 w-4" /> No route matches — this would 404
                  </p>
                  {result.reason && (
                    <p className="mt-2 text-xs text-muted-foreground">{result.reason}</p>
                  )}
                  <p className="mt-3 text-xs font-medium text-foreground">Closest routes</p>
                  <ul className="mt-1 space-y-1">
                    {result.suggestions.map((s) => (
                      <li key={s.routeId} className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setPath(s.pattern)}
                          className="min-w-0 flex-1 truncate text-left font-mono text-xs text-foreground hover:underline"
                        >
                          {s.pattern}
                        </button>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {Math.round(s.score * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Recent 404s */}
        <section className="mt-4 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Recent 404s in this browser ({log.length})
            </h2>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setLog(readNotFoundLog())}
                className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                aria-label="Refresh 404 log"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  clearNotFoundLog();
                  setLog([]);
                }}
                className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:text-destructive"
                aria-label="Clear 404 log"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {log.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Nothing captured yet. Any 404 you hit gets recorded here automatically.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {log.map((entry) => (
                <li
                  key={`${entry.path}-${entry.at}`}
                  className="rounded-lg border border-border bg-background p-2"
                >
                  <button
                    type="button"
                    onClick={() => setPath(entry.path)}
                    className="block w-full break-all text-left font-mono text-xs text-foreground hover:underline"
                  >
                    {entry.path}
                  </button>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(entry.at).toLocaleString()}
                    {entry.referrer ? ` · from ${entry.referrer}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Route inventory */}
        <section className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-foreground">Known routes ({routes.length})</h2>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter routes…"
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <ul className="mt-3 max-h-96 space-y-1 overflow-y-auto">
            {visibleRoutes.map((r) => (
              <li key={r.routeId} className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setPath(r.pattern)}
                  className="min-w-0 flex-1 truncate text-left font-mono text-xs text-foreground hover:underline"
                >
                  {r.pattern}
                </button>
                {isLayoutOnlyId(r.routeId) && (
                  <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    layout
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-6 text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
