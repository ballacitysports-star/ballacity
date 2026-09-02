import { useChildConsentTrail } from "@/lib/child-safety";
import { CONSENT_METHOD_META, type ConsentMethod } from "@/lib/child-policy";

const ACTION_LABELS: Record<string, string> = {
  consent_requested: "Approval requested",
  consent_approved: "Approval granted",
  consent_revoked: "Approval withdrawn",
  consent_expired: "Approval link expired",
  consent_reverified: "Approval re-confirmed",
};

function methodLabel(method: string | null): string | null {
  if (!method || method === "unverified") return null;
  const meta = CONSENT_METHOD_META[method as ConsentMethod];
  return meta?.label ?? method;
}

/**
 * Guardian-facing consent audit trail. Every consent transition is recorded
 * server-side; this is the human-readable view of that record.
 */
export function ConsentTrail({ childUserId }: { childUserId: string }) {
  const { entries, isLoading } = useChildConsentTrail(childUserId);

  return (
    <div className="mt-4 rounded-xl border border-border bg-background p-3">
      <h3 className="text-sm font-semibold">Approval history</h3>
      {isLoading ? (
        <p className="mt-1 text-xs text-muted-foreground">Loading history…</p>
      ) : entries.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">No approval activity recorded yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {entries.map((e) => {
            const m = methodLabel(e.method);
            return (
              <li key={e.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">
                    {ACTION_LABELS[e.action] ?? e.action}
                  </span>
                  {m ? <span className="text-muted-foreground"> · {m}</span> : null}
                </span>
                <time className="shrink-0 text-muted-foreground" dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleDateString()}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
