import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users } from "lucide-react";
import { adminFamilyOverview, type AdminFamilyOverview } from "@/lib/child-safety.functions";
import { COHORT_META } from "@/lib/child-policy";

/**
 * Admin-side view of every guardian/minor relationship on the platform,
 * with consent state and a tally of family invitations. Read-only: consent
 * changes stay with the guardian, and account actions stay in the existing
 * queues so every change keeps its audit trail.
 */
export function AdminFamilyPanel() {
  const fetchFamilies = useServerFn(adminFamilyOverview);
  const query = useQuery({
    queryKey: ["admin-family-overview"],
    queryFn: () => fetchFamilies() as Promise<AdminFamilyOverview>,
    retry: false,
  });

  const data = query.data;

  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-sm font-bold">Families</h2>
      </div>

      {query.isLoading ? (
        <p className="mt-1 text-xs text-muted-foreground">Loading…</p>
      ) : query.isError || !data ? (
        <p className="mt-1 text-xs text-muted-foreground">Family data is unavailable.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {Object.entries(data.inviteCounts).length === 0 ? (
              <span className="text-muted-foreground">No family invitations yet.</span>
            ) : (
              Object.entries(data.inviteCounts).map(([status, count]) => (
                <span key={status} className="rounded-full border border-border px-2 py-0.5">
                  {count} {status} invite{count === 1 ? "" : "s"}
                </span>
              ))
            )}
          </div>

          {data.families.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No guardian links yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.families.map((f) => (
                <li key={f.linkId} className="rounded-xl border border-border bg-background p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {f.parentName} → {f.childName}
                    </span>
                    <span className="text-muted-foreground">
                      {COHORT_META[f.childCohort].short}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                    <span className="capitalize">{f.relationship.replace("_", " ")}</span>
                    <span>Link: {f.verified ? "verified" : f.linkStatus}</span>
                    <span>Consent: {f.consentStatus ?? "not required"}</span>
                    <span>{new Date(f.createdAt).toLocaleDateString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
