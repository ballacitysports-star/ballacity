import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  childSafetyOverview,
  resolveAgeReview,
  resolveParentRequest,
  type ChildSafetyOverview,
} from "@/lib/child-safety.functions";
import { CHILD_POLICY_DISCLAIMER, COHORT_META, parseCohort } from "@/lib/child-policy";
import { Button } from "@/components/ui/button";
import { BirthdayCorrectionQueue } from "@/components/child/BirthdayCorrectionQueue";
import { AdminFamilyPanel } from "@/components/child/AdminFamilyPanel";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

/**
 * Child-safety queues (birthday corrections, consent, age reviews, guardian
 * requests). Shared by /admin/child-safety and the superadmin Youth tab; the
 * server functions enforce the moderator/superadmin check.
 */
export function ChildSafetyPanel() {
  const fetchOverview = useServerFn(childSafetyOverview);
  const clearReview = useServerFn(resolveAgeReview);
  const resolveRequest = useServerFn(resolveParentRequest);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["admin-child-safety"],
    queryFn: () => fetchOverview() as Promise<ChildSafetyOverview>,
    retry: false,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-child-safety"] });

  if (query.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Not authorized — this section is restricted to moderators and administrators.
      </p>
    );
  }

  const data = query.data;

  return (
    <div>
      {query.isLoading || !data ? (
        <p className="mt-6 page-subtitle">Loading…</p>
      ) : (
        <>
          <section className="mt-5">
            <h2 className="section-title">Accounts by age group</h2>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(data.cohortCounts).map(([cohort, count]) => (
                <Stat key={cohort} label={COHORT_META[parseCohort(cohort)].short} value={count} />
              ))}
            </div>
          </section>

          <AdminFamilyPanel />

          <BirthdayCorrectionQueue />

          <section className="mt-5">
            <h2 className="section-title">Parental consent</h2>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {["required", "pending", "approved", "revoked", "expired"].map((s) => (
                <Stat key={s} label={s} value={data.consentCounts[s] ?? 0} />
              ))}
            </div>
          </section>

          <section className="mt-5 rounded-2xl border border-border bg-surface p-4">
            <h2 className="section-title">Age changes awaiting review</h2>
            {data.ageReviews.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Nothing to review.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.ageReviews.map((r) => (
                  <li key={r.userId} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">
                      {r.displayName} · currently {COHORT_META[r.cohort].short}
                    </span>
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await clearReview({ data: { userId: r.userId, approve: true } });
                          toast.success("Age change applied");
                          refresh();
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await clearReview({ data: { userId: r.userId, approve: false } });
                          toast.success("Kept the restricted age group");
                          refresh();
                        }}
                      >
                        Keep restricted
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-5 rounded-2xl border border-border bg-surface p-4">
            <h2 className="section-title">Guardian requests</h2>
            {data.openRequests.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No open requests.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.openRequests.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-border bg-background p-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold capitalize">{r.kind.replace("_", " ")}</span>
                      <span className="text-muted-foreground">{r.status}</span>
                    </div>
                    {r.details ? <p className="mt-1 text-muted-foreground">{r.details}</p> : null}
                    <div className="mt-2 flex gap-1">
                      {(["in_progress", "completed", "denied"] as const).map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await resolveRequest({ data: { id: r.id, status: s } });
                            toast.success("Request updated");
                            refresh();
                          }}
                        >
                          {s.replace("_", " ")}
                        </Button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-5 rounded-2xl border border-border bg-surface p-4 text-xs text-muted-foreground">
            <h2 className="section-title text-foreground">Active policy</h2>
            <ul className="mt-2 space-y-1">
              <li>Child cohort: up to age {data.policy.childMaxAge}</li>
              <li>
                Younger teen cohort: {data.policy.childMaxAge + 1}–{data.policy.teenMidMaxAge}
              </li>
              <li>Adult at: {data.policy.adultAge}</li>
              <li>Parental consent required up to age {data.policy.parentalConsentMaxAge}</li>
              <li>Default jurisdiction: {data.policy.jurisdiction}</li>
              <li>
                Biometric age estimation:{" "}
                {data.policy.biometricAgeEstimationEnabled ? "enabled" : "disabled"} (legal decision
                required before enabling)
              </li>
            </ul>
          </section>
        </>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        {CHILD_POLICY_DISCLAIMER}
      </p>
    </div>
  );
}
