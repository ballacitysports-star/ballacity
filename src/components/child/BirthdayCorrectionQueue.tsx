import * as React from "react";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { useBirthdayCorrectionQueue, useReviewBirthdayCorrection } from "@/lib/birthday-lock";
import { birthdayToDisplay } from "@/components/profile/ProfileFormPrimitives";

/**
 * Support review queue for locked-birthday corrections. Approving is the only
 * way a stored date of birth can change, and every decision is audited.
 */
export function BirthdayCorrectionQueue() {
  const { data, isLoading, error } = useBirthdayCorrectionQueue("pending");
  const review = useReviewBirthdayCorrection();
  const [notes, setNotes] = React.useState<Record<string, string>>({});

  const decide = async (id: string, approve: boolean) => {
    try {
      await review.mutateAsync({ id, approve, notes: notes[id] ?? "" });
      toast.success(approve ? "Date of birth corrected." : "Request declined.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that decision.");
    }
  };

  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : "Could not load birthday corrections."
    : null;

  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-display text-sm font-bold">Birthday corrections</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Dates of birth are locked after registration. Approving a request updates the date and
        recalculates that member's age group and permissions.
      </p>

      {isLoading ? (
        <div className="mt-3 text-xs text-muted-foreground">Loading…</div>
      ) : (data?.length ?? 0) === 0 ? (
        <div className="mt-3 text-xs text-muted-foreground">No requests waiting.</div>
      ) : (
        <ul className="mt-3 space-y-3">
          {data!.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-background p-3">
              <div className="text-sm font-semibold">
                {r.displayName ?? "Member"}
                {r.handle ? (
                  <span className="ml-1 text-xs text-muted-foreground">@{r.handle}</span>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {r.currentBirthday ? birthdayToDisplay(r.currentBirthday) : "none"} →{" "}
                <span className="font-semibold text-foreground">
                  {birthdayToDisplay(r.requestedBirthday)}
                </span>
              </div>
              <p className="mt-2 text-xs leading-snug">{r.reason}</p>
              {r.evidence ? (
                <p className="mt-1 text-[11px] text-muted-foreground">{r.evidence}</p>
              ) : null}
              <input
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                placeholder="Review note (optional)"
                className="mt-2 w-full rounded-full border border-border bg-surface px-3 py-1.5 text-xs outline-none focus:border-lime"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={review.isPending}
                  onClick={() => void decide(r.id, true)}
                  className="rounded-full bg-lime px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={review.isPending}
                  onClick={() => void decide(r.id, false)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
