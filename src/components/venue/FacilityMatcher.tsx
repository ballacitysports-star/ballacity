import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, ShieldCheck, X } from "lucide-react";
import { listTrainerOrgs } from "@/lib/trainer-orgs.functions";
import { venueSearchTerm } from "@/lib/facility-hub";

type FacilityRow = {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  verified?: boolean | null;
};

const MAX_SUGGESTIONS = 3;
const MIN_QUERY = 3;

/**
 * "Hosting at a registered gym?" on the create form. While the host types a
 * venue, suggests matching registered facilities; linking one attaches the run
 * to it (so it shows on the gym's page and the game page's venue card) and
 * pre-fills the address. Purely a convenience: the host can ignore it, and the
 * server still decides whether the run is official or a community run.
 */
export function FacilityMatcher({
  location,
  linked,
  onLink,
  onUnlink,
}: {
  /** The venue text currently in the address field. */
  location: string;
  /** The facility this run is linked to, if any. */
  linked: { id: string; name: string } | null;
  onLink: (facilityId: string) => void;
  onUnlink: () => void;
}) {
  const list = useServerFn(listTrainerOrgs);
  const term = venueSearchTerm(location);
  const [debounced, setDebounced] = useState(term);
  // Facilities the host unlinked: don't keep re-suggesting what they declined.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 350);
    return () => clearTimeout(t);
  }, [term]);

  const enabled = !linked && debounced.length >= MIN_QUERY;
  const q = useQuery({
    queryKey: ["facility-matcher", debounced],
    queryFn: () => list({ data: { q: debounced } }),
    enabled,
    staleTime: 60_000,
  });
  const matches = useMemo(
    () =>
      ((q.data ?? []) as unknown as FacilityRow[])
        .filter((o) => !dismissed.has(o.id))
        .slice(0, MAX_SUGGESTIONS),
    [q.data, dismissed],
  );

  if (linked) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border border-lime/40 bg-lime/10 px-3 py-2 text-xs"
      >
        <Building2 className="h-4 w-4 shrink-0 text-lime" aria-hidden />
        <span className="min-w-0 flex-1">
          Linked to <span className="font-bold">{linked.name}</span> — this run will show on its
          page.
        </span>
        <button
          type="button"
          onClick={() => {
            setDismissed((d) => new Set(d).add(linked.id));
            onUnlink();
          }}
          aria-label={`Unlink ${linked.name} from this run`}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 font-semibold text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" aria-hidden /> Unlink
        </button>
      </div>
    );
  }

  if (!enabled || matches.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">
        Hosting at a registered gym?
      </div>
      <ul className="space-y-1.5">
        {matches.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onLink(o.id)}
              aria-label={`Host this run at ${o.name}`}
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm hover:border-lime/60"
            >
              <Building2 className="h-4 w-4 shrink-0 text-lime" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 font-semibold">
                  <span className="truncate">{o.name}</span>
                  {o.verified && (
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-lime" aria-label="Verified" />
                  )}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {[o.address, o.city].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-xs font-bold text-lime">Link run</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
