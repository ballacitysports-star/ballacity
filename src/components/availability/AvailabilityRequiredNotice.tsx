import { Link } from "@tanstack/react-router";
import { UserCog, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { useMyProfiles, useSwitchProfile, type AccountProfile } from "@/lib/account-profiles";
import { availabilityGateMessage, type AvailabilityGateReason } from "@/lib/availability-gate";

/**
 * Inline explanation of why the viewer can't post availability yet, with the
 * one-tap fix (switch to the player profile, finish the profile, or sign in).
 */
export function AvailabilityRequiredNotice({
  reason,
  onSwitched,
  className = "",
}: {
  reason: AvailabilityGateReason;
  /** Called after switching into the player profile succeeds. */
  onSwitched?: () => void;
  className?: string;
}) {
  const { profiles } = useMyProfiles();
  const switcher = useSwitchProfile();
  if (!reason) return null;

  const playerProfile: AccountProfile | undefined = profiles.find((p) => p.kind === "player");

  return (
    <div
      className={`rounded-2xl border border-dashed border-border bg-surface/60 p-4 text-sm ${className}`}
      role="status"
    >
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">{availabilityGateMessage(reason)}</p>
          {reason === "wrong_profile" && (
            <p className="mt-1 text-muted-foreground">
              You're acting as another profile right now. Switch back to your player profile to post
              when you're free to play.
            </p>
          )}
          {reason === "incomplete_profile" && (
            <p className="mt-1 text-muted-foreground">
              Hosts match players on sport and level, so add at least one favorite sport with a
              level first.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {reason === "signed_out" && (
              <Link
                to="/auth"
                className="rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground"
              >
                Sign in
              </Link>
            )}
            {reason === "wrong_profile" && playerProfile && (
              <button
                type="button"
                disabled={switcher.isPending}
                onClick={() =>
                  switcher.mutate(playerProfile, {
                    onSuccess: () => {
                      toast.success(`Switched to ${playerProfile.name}`);
                      onSwitched?.();
                    },
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : "Could not switch profile"),
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
              >
                <UserCog className="h-3.5 w-3.5" aria-hidden />
                Switch to my player profile
              </button>
            )}
            {reason === "incomplete_profile" && (
              <Link
                to="/profile/edit"
                className="rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground"
              >
                Complete my profile
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
