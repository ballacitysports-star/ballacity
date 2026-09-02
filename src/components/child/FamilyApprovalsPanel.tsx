import { Link } from "@tanstack/react-router";
import { BellRing, Clock } from "lucide-react";
import { useFamilyApprovals } from "@/lib/family-approvals";

/**
 * One shared place where every guardian-facing approval shows up, whatever
 * feature raised it — consent, family invitations, or data requests.
 */
export function FamilyApprovalsPanel() {
  const { approvals, actionNeeded, isLoading } = useFamilyApprovals();
  if (isLoading || approvals.length === 0) return null;

  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        {actionNeeded.length > 0 ? (
          <BellRing className="h-4 w-4 text-primary" aria-hidden />
        ) : (
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
        <h2 className="text-sm font-bold">
          {actionNeeded.length > 0
            ? `${actionNeeded.length} thing${actionNeeded.length === 1 ? "" : "s"} need you`
            : "Waiting on others"}
        </h2>
      </div>

      <ul className="mt-3 space-y-2">
        {approvals.map((a) => (
          <li
            key={a.id}
            className={`rounded-xl border p-3 text-xs ${
              a.urgency === "action_needed" ? "border-primary/40 bg-primary/5" : "border-border bg-background"
            }`}
          >
            <div className="text-sm font-semibold capitalize">{a.title}</div>
            <p className="mt-1 text-muted-foreground">{a.detail}</p>
            {a.actionLabel && a.actionTo ? (
              <Link
                to={a.actionTo}
                className="mt-2 inline-block font-semibold text-primary underline"
              >
                {a.actionLabel}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
