import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarDays, ChevronRight, Mail, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/user-error";
import { useAuth } from "@/hooks/use-auth";
import { useParentMode } from "@/hooks/use-parent-mode";
import { supabase } from "@/integrations/supabase/client";
import {
  listMyAvailabilities,
  listMyContactRequests,
  reconfirmAvailability,
} from "@/lib/availability";
import { availabilityGateMessage, useAvailabilityGate } from "@/lib/availability-gate";
import { listMyPendingGameInvites } from "@/lib/game-invites";
import {
  HOME_AVAILABILITY_SETTING_KEY,
  parseHomeAvailabilitySetting,
  sportsLabel,
  summarizeHomeAvailability,
  type HomePost,
} from "@/lib/home-availability";
import { QuickAvailabilitySheet } from "@/components/availability/QuickAvailabilitySheet";
import { AvailabilityRequiredNotice } from "@/components/availability/AvailabilityRequiredNotice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Reads the switch. A failed read keeps the new Home (see parseHomeAvailabilitySetting). */
export async function fetchHomeAvailabilitySwitch(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", HOME_AVAILABILITY_SETTING_KEY)
      .maybeSingle();
    if (error) return true;
    return parseHomeAvailabilitySetting((data as { value?: unknown } | null)?.value);
  } catch {
    return true;
  }
}

/**
 * WP 1.6: the top of Home for a signed-in player. A large "I'm available" card (or, once they are listed, where their
 * availability stands, with "Still available" in one tap when it is about to run out), then four shortcuts: Find
 * players, Find games, My games and Invitations (pending invitations and contact requests to them, counted).
 *
 * "Find games" and "My games" are Home's own games list (/discover only redirects back to Home): `onGames("all")` shows
 * everyone's games, `onGames("joined")` the games the member joined, and Home scrolls to the list.
 *
 * Hidden in parent mode (a guardian acting for a child uses the family screens) and when a Super admin turns the
 * `home_availability_first` switch off. The feed below is unchanged.
 *
 * WP 4.1: while the switch loads, a placeholder of the section's height holds the space so Home doesn't jump. "I'm
 * available" and "Add a time" open the quick sheet; a member who can't post yet gets a dialog saying why, with the
 * next step ("Complete my profile" comes back to posting). "My availability" and "Invitations" open one screen,
 * /availability.
 */
export function AvailabilityHome({
  className = "",
  onGames,
}: {
  className?: string;
  onGames: (which: "all" | "joined") => void;
}) {
  const { user } = useAuth();
  const { isParentMode } = useParentMode();
  const enabled = useQuery({
    queryKey: ["home-availability-switch"],
    queryFn: fetchHomeAvailabilitySwitch,
    staleTime: 5 * 60_000,
  });
  if (!user || isParentMode) return null;
  if (enabled.isLoading) return <HomeAvailabilitySkeleton className={className} />;
  if (enabled.data !== true) return null;
  return <Section userId={user.id} className={className} onGames={onGames} />;
}

/** The section's height while the switch loads: the card (112px), the gap (12px) and the shortcuts row (76px). */
function HomeAvailabilitySkeleton({ className }: { className: string }) {
  return (
    <div className={className} aria-hidden data-testid="home-availability-skeleton">
      <div className="h-[112px] animate-pulse rounded-3xl border border-border bg-surface" />
      <div className="mt-3 grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[76px] animate-pulse rounded-2xl border border-border bg-surface"
          />
        ))}
      </div>
    </div>
  );
}

function Section({
  userId,
  className,
  onGames,
}: {
  userId: string;
  className: string;
  onGames: (which: "all" | "joined") => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const gate = useAvailabilityGate();
  const [quickOpen, setQuickOpen] = useState(false);
  // Why posting isn't possible yet, in a dialog with the next step (never a silent redirect).
  const [gateOpen, setGateOpen] = useState(false);
  // A tap that came while the posting check was still loading; answered as soon as it settles.
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);

  // Same query key as the posting gate, so both read one cached list.
  const mine = useQuery({
    queryKey: ["my-availabilities", userId],
    queryFn: () => listMyAvailabilities(),
    staleTime: 30_000,
  });
  const invitations = useQuery({
    queryKey: ["home-pending-invitations", userId],
    // Pending contact requests plus game invitations waiting for an answer (WP 2.0).
    queryFn: async () => {
      const [requests, invites] = await Promise.all([
        listMyContactRequests("inbox"),
        listMyPendingGameInvites(userId).catch(() => []),
      ]);
      return requests.filter((r) => r.status === "pending").length + invites.length;
    },
    staleTime: 60_000,
  });

  const summary = summarizeHomeAvailability((mine.data ?? []) as unknown as HomePost[]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-availabilities", userId] });

  const post = () => {
    if (gate.loading) setWaiting(true);
    else if (gate.canPost) setQuickOpen(true);
    else setGateOpen(true);
  };
  useEffect(() => {
    if (!waiting || gate.loading) return;
    setWaiting(false);
    if (gate.canPost) setQuickOpen(true);
    else setGateOpen(true);
  }, [waiting, gate.loading, gate.canPost]);

  const stillAvailable = async (p: HomePost) => {
    setBusy(true);
    try {
      await reconfirmAvailability(p.id, p.status as never);
      toast.success("Thanks, you're listed for 2 more weeks");
      await refresh();
    } catch (e) {
      toast.error(userErrorMessage(e, "Couldn't update your availability. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const pending = invitations.data ?? 0;

  return (
    <section aria-label="Your availability" className={className}>
      {mine.isLoading ? (
        <div
          className="h-[112px] animate-pulse rounded-3xl border border-border bg-surface"
          aria-hidden
        />
      ) : summary.kind === "none" ? (
        <button
          type="button"
          onClick={post}
          aria-busy={waiting || undefined}
          className="flex w-full items-center gap-4 rounded-3xl bg-lime-gradient p-5 text-left text-primary-foreground glow-lime"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-black/15">
            <Plus className="h-6 w-6" strokeWidth={2.5} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xl font-extrabold leading-tight">I'm available</span>
            <span className="block text-sm opacity-90">
              Tell players near you when you can play. Takes three taps.
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
        </button>
      ) : (
        <div
          className={`rounded-3xl border p-4 ${
            summary.kind === "attention"
              ? "border-coral/40 bg-coral/10"
              : "border-lime/30 bg-surface"
          }`}
        >
          <div className="flex items-start gap-3">
            <CalendarCheck
              className={`mt-0.5 h-6 w-6 shrink-0 ${summary.kind === "attention" ? "text-coral" : "text-lime"}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold">
                {summary.kind === "attention" ? "Still available to play?" : "You're available"}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {sportsLabel(summary.post.sports)} · {summary.listing.label}
                {summary.count > 1 ? ` · and ${summary.count - 1} more` : ""}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.kind === "attention" && summary.listing.canReconfirm && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void stillAvailable(summary.post)}
                className="min-h-11 rounded-full bg-lime-gradient px-4 text-sm font-bold text-primary-foreground disabled:opacity-60"
              >
                Still available
              </button>
            )}
            <Link
              to="/availability"
              className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold"
            >
              My availability
            </Link>
            <button
              type="button"
              onClick={post}
              aria-busy={waiting || undefined}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-4 text-sm font-semibold"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add a time
            </button>
          </div>
        </div>
      )}

      <nav aria-label="Shortcuts" className="mt-3 grid grid-cols-4 gap-2">
        <Shortcut to="/players" icon={Users} label="Find players" />
        <button
          type="button"
          onClick={() => onGames("all")}
          className="relative flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface px-1 text-center"
        >
          <Search className="h-5 w-5 text-lime" aria-hidden />
          <span className="text-[11px] font-semibold leading-tight">Find games</span>
        </button>
        <button
          type="button"
          onClick={() => onGames("joined")}
          className="relative flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface px-1 text-center"
        >
          <CalendarDays className="h-5 w-5 text-lime" aria-hidden />
          <span className="text-[11px] font-semibold leading-tight">My games</span>
        </button>
        <Shortcut to="/availability" icon={Mail} label="Invitations" count={pending} />
      </nav>

      {quickOpen && (
        <QuickAvailabilitySheet
          open={quickOpen}
          onOpenChange={setQuickOpen}
          onPosted={() => {
            setQuickOpen(false);
            void refresh();
            toast.success("You're listed. Players near you can see when you're free.");
          }}
          onMoreOptions={() => {
            setQuickOpen(false);
            // The full form (several days, a note, a travel radius) on My availability & invitations.
            void navigate({ to: "/availability", search: { compose: "more" } });
          }}
        />
      )}

      <Dialog open={gateOpen} onOpenChange={setGateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Post your availability</DialogTitle>
            {/* The reason, announced with the title when the dialog opens. */}
            <DialogDescription className="sr-only">
              {availabilityGateMessage(gate.reason)}
            </DialogDescription>
          </DialogHeader>
          <AvailabilityRequiredNotice
            reason={gate.reason}
            onSwitched={() => {
              // Ask the posting check again: the player profile may still need a sport and level, and that step
              // belongs in this dialog, not in a sheet that can't post.
              setGateOpen(false);
              setWaiting(true);
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Shortcut({
  to,
  icon: Icon,
  label,
  count = 0,
}: {
  to: string;
  icon: typeof Users;
  label: string;
  count?: number;
}) {
  const named = count > 0 ? `${label}, ${count} waiting` : label;
  return (
    <Link
      to={to as never}
      aria-label={named}
      className="relative flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface px-1 text-center"
    >
      <Icon className="h-5 w-5 text-lime" aria-hidden />
      <span className="text-[11px] font-semibold leading-tight">{label}</span>
      {count > 0 && (
        <span
          aria-hidden
          className="absolute right-1.5 top-1.5 grid min-w-5 place-items-center rounded-full bg-coral-strong px-1 text-[10px] font-bold text-white"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
