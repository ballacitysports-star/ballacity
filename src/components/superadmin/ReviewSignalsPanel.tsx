import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { superadminReviewSignals } from "@/lib/superadmin.functions";

/**
 * Read-only abuse signals. They point a human at accounts worth a look; they
 * never hide or penalise anything on their own.
 */
export function ReviewSignalsPanel() {
  const load = useServerFn(superadminReviewSignals);
  const { data, isLoading, error } = useQuery({
    queryKey: ["superadmin-review-signals"],
    queryFn: () => load(),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="p-3 text-sm text-muted-foreground">Loading signals…</div>;
  if (error)
    return <div className="p-3 text-sm text-destructive">Couldn't load review signals.</div>;

  const rings = data?.rings ?? [];
  const uniform = data?.uniform ?? [];

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div>
        <div className="text-sm font-semibold">Mutual high ratings (60 days)</div>
        <p className="text-[11px] text-muted-foreground">
          Pairs who each reviewed the other 2+ times, averaging 4.5★ or better.
        </p>
        {rings.length === 0 ? (
          <div className="mt-1 text-xs text-muted-foreground">None found.</div>
        ) : (
          <ul className="mt-1 divide-y text-xs font-mono">
            {rings.map((r) => (
              <li key={`${r.user_a}-${r.user_b}`} className="py-1">
                {r.user_a} ⇄ {r.user_b} · {r.a_to_b}/{r.b_to_a} · {r.avg_rating}★
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold">Uniform raters</div>
        <p className="text-[11px] text-muted-foreground">
          6+ reviews with almost no variation in score.
        </p>
        {uniform.length === 0 ? (
          <div className="mt-1 text-xs text-muted-foreground">None found.</div>
        ) : (
          <ul className="mt-1 divide-y text-xs font-mono">
            {uniform.map((r) => (
              <li key={r.reviewer_id} className="py-1">
                {r.reviewer_id} · {r.reviews} reviews · avg {r.avg_rating} · σ {r.stddev_rating}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
