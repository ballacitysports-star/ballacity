import * as React from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useMyBirthdayLock, useRequestBirthdayCorrection } from "@/lib/birthday-lock";
import { birthdayToDisplay } from "@/components/profile/ProfileFormPrimitives";
import { AGE_CATEGORY_LABELS, ageCategoryFromBirthday } from "@/lib/age-policy";

/**
 * Read-only date of birth with a support-reviewed correction request.
 *
 * The date of birth drives every age-based permission, so it is locked once
 * saved — the database refuses direct changes. Members can only ask support to
 * correct it, and every decision is written to an immutable history.
 */
export function BirthdayLockCard() {
  const { data, isLoading } = useMyBirthdayLock();
  const request = useRequestBirthdayCorrection();
  const [open, setOpen] = React.useState(false);
  const [dob, setDob] = React.useState("");
  const [reason, setReason] = React.useState("");

  if (isLoading) return null;
  const birthday = data?.birthday ?? null;
  const pending = data?.requests.find((r) => r.status === "pending") ?? null;
  const latest = data?.requests[0] ?? null;

  const trimmedReason = reason.trim();
  const formError = !/^\d{4}-\d{2}-\d{2}$/.test(dob)
    ? "Enter the correct date of birth as month, day and year."
    : trimmedReason.length < 10
      ? "Tell us in a sentence why the date needs correcting."
      : null;

  const submit = async () => {
    if (formError) {
      toast.error(formError);
      return;
    }
    try {
      await request.mutateAsync({ requestedBirthday: dob, reason: trimmedReason });
      toast.success("Correction sent. Support will review it and let you know.");
      setOpen(false);
      setDob("");
      setReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send that request.");
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold">Date of birth</div>
          <div className="mt-1 text-sm">
            {birthday ? birthdayToDisplay(birthday) : "Not set yet"}
            {birthday ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {AGE_CATEGORY_LABELS[ageCategoryFromBirthday(birthday)]}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-snug text-muted-foreground">
            Your date of birth sets your age group and what the app turns on, so it can't be edited
            after you save it. If it's wrong, ask us to correct it.
          </p>

          {pending ? (
            <div className="mt-3 rounded-xl border border-lime/40 bg-lime/10 p-2 text-[11px] leading-snug">
              Birthday correction submitted · Under BallaCity staff review (requested {birthdayToDisplay(pending.requestedBirthday)}).
            </div>
          ) : latest && latest.status !== "pending" ? (
            <div className="mt-3 rounded-xl border border-border bg-background p-2 text-[11px] leading-snug">
              Last request to {birthdayToDisplay(latest.requestedBirthday)} was {latest.status}.
              {latest.reviewNotes ? ` ${latest.reviewNotes}` : ""}
            </div>
          ) : null}

          {birthday && !pending ? (
            open ? (
              <div className="mt-3 space-y-2">
                <label className="block text-[11px] font-semibold text-muted-foreground">
                  Correct date of birth
                  <input
                    type="date"
                    value={dob}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDob(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
                  />
                </label>
                <label className="block text-[11px] font-semibold text-muted-foreground">
                  Why does it need correcting?
                  <textarea
                    value={reason}
                    rows={3}
                    maxLength={400}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Tell us what happened, e.g. the year was typed wrong at signup."
                    className="mt-1 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
                  />
                </label>
                {formError ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">{formError}</p>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={request.isPending || !!formError}
                    onClick={() => void submit()}

                    className="rounded-full bg-lime px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
                  >
                    {request.isPending ? "Sending…" : "Send for review"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-full border border-border px-4 py-2 text-xs font-bold"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Request a correction
              </button>
            )
          ) : null}
        </div>
      </div>
    </section>
  );
}
