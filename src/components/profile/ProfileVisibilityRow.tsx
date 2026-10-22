import { Link } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useMyChildStatus } from "@/lib/child-safety";
import { useMyPrivacy } from "@/lib/privacy";
import {
  clearRememberedVisibility,
  isProfileHidden,
  readRememberedVisibility,
  rememberVisibility,
  visibilityAfterShow,
} from "@/lib/profile-visibility";

/**
 * Quick Hide / Show for your own player profile. It flips the same
 * "Profile visibility" setting as Account → Privacy, which the database
 * enforces, so a hidden profile is hidden for real and not just in the UI.
 *
 * Adults only: a younger member's visibility is governed by their guardian's
 * controls, so no one-tap "show everyone" is offered to them.
 */
export function ProfileVisibilityRow() {
  const { user } = useAuth();
  const { status } = useMyChildStatus();
  const { prefs, isLoading, saving, update } = useMyPrivacy();

  if (!user || isLoading || status?.cohort !== "adult") return null;

  const hidden = isProfileHidden(prefs.profile_visibility);
  const visibleTo = prefs.profile_visibility === "members" ? "Signed-in members" : "Everyone";

  const toggle = async () => {
    try {
      if (hidden) {
        await update({
          profile_visibility: visibilityAfterShow(readRememberedVisibility(user.id)),
        });
        clearRememberedVisibility(user.id);
        toast.success("Your profile is visible again");
      } else {
        rememberVisibility(user.id, prefs.profile_visibility);
        await update({ profile_visibility: "private" });
        toast.success("Your profile is hidden");
      }
    } catch {
      toast.error("Couldn't change your profile visibility. Try again.");
    }
  };

  return (
    <div className="px-4 pt-3">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
        {hidden ? (
          <EyeOff className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Eye className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-sm font-semibold">
            {hidden ? "Your profile is hidden" : `Visible to ${visibleTo.toLowerCase()}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {hidden ? (
              "Only you can open it. You can still join games."
            ) : (
              <>
                <Link to="/account/privacy" className="underline underline-offset-2">
                  Privacy settings
                </Link>{" "}
                for finer control.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={saving}
          className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-60 ${
            hidden
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-surface-2 text-foreground hover:bg-background"
          }`}
        >
          {hidden ? "Show profile" : "Hide profile"}
        </button>
      </div>
    </div>
  );
}
