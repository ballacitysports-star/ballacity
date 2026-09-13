/**
 * Route Doctor — 404 diagnostics helpers.
 *
 * Keeps a rolling log of unmatched routes in localStorage and provides
 * path-matching / suggestion utilities so broken links can be reproduced
 * and traced back to a real route quickly.
 */

const LOG_KEY = "openrun:404-log";
const MAX_ENTRIES = 50;

export type NotFoundEntry = {
  path: string;
  referrer: string;
  at: string;
};

export function logNotFound(path: string, referrer = "") {
  if (typeof window === "undefined") return;
  try {
    const entries = readNotFoundLog();
    const next: NotFoundEntry[] = [
      { path, referrer, at: new Date().toISOString() },
      ...entries.filter((e) => e.path !== path),
    ].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(LOG_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function readNotFoundLog(): NotFoundEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NotFoundEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearNotFoundLog() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOG_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Strip pathless layout segments (`/_tabs`) so route ids become real URLs. */
export function routeIdToUrl(id: string): string {
  const url = id
    .split("/")
    .filter((seg) => seg && !seg.startsWith("_"))
    .join("/");
  return "/" + url;
}

export function isLayoutOnlyId(id: string): boolean {
  return id.split("/").some((seg) => seg.startsWith("_"));
}

export type MatchResult = {
  matched: boolean;
  routeId?: string;
  pattern?: string;
  params?: Record<string, string>;
  suggestions: { pattern: string; routeId: string; score: number }[];
  reason?: string;
};

function segmentsOf(path: string): string[] {
  return path.split("?")[0].split("#")[0].split("/").filter(Boolean);
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const p = segmentsOf(pattern);
  const t = segmentsOf(path);
  const params: Record<string, string> = {};
  const splatIndex = p.findIndex((s) => s === "$");
  if (splatIndex >= 0) {
    if (t.length < splatIndex) return null;
  } else if (p.length !== t.length) {
    return null;
  }
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg === "$") {
      params["*"] = t.slice(i).join("/");
      return params;
    }
    if (seg.startsWith("$")) {
      if (!t[i]) return null;
      params[seg.slice(1)] = t[i];
      continue;
    }
    if (seg !== t[i]) return null;
  }
  return params;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length) || 1;
  return 1 - levenshtein(a, b) / max;
}

/**
 * Test a path against the app's known route patterns.
 * `routes` is a list of `{ routeId, pattern }` derived from the router.
 */
export function diagnosePath(
  path: string,
  routes: { routeId: string; pattern: string }[],
): MatchResult {
  const clean = path.trim() ? path.trim() : "/";
  const normalized = clean.startsWith("/") ? clean : `/${clean}`;

  for (const r of routes) {
    const params = matchPattern(r.pattern, normalized);
    if (params) {
      return {
        matched: true,
        routeId: r.routeId,
        pattern: r.pattern,
        params,
        suggestions: [],
      };
    }
  }

  const suggestions = routes
    .map((r) => ({ ...r, score: similarity(normalized, r.pattern) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const layoutHit = routes.find((r) => isLayoutOnlyId(r.routeId) && r.routeId === normalized);

  return {
    matched: false,
    suggestions,
    reason: layoutHit
      ? "This looks like an internal layout id, not a URL. Link to the public path instead."
      : undefined,
  };
}
