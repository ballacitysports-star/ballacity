import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarDays, ChevronRight, Mail, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useParentMode } from "@/hooks/use-parent-mode";
import { supabase } from "@/integrations/supabase/client";
import {
  listMyAvailabilities,
  listMyContactRequests,
  reconfirmAvailability,
} from "@/lib/availability";
import { useAvailabilityGate } from "@/lib/availability-gate";
import {
  HOME_AVAILABILITY_SETTING_KEY,
  parseHomeAvailabilitySetting,
  sportsLabel,
  summarizeHomeAvailability,
  type HomePost,
} from "@/lib/home-availability";
import { QuickAvailabilitySheet } from "@/components/availability/QuickAvailabilitySheet";

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
 * Hidden in parent mode (a guardian acting for a child uses the family screens) and when a Super admin turns the
 * `home_availability_first` switch off. The feed below is unchanged.
 */
export function AvailabilityHome({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const { isParentMode } = useParentMode();
  const enabled = useQuery({
    queryKey: ["home-availability-switch"],
    queryFn: fetchHomeAvailabilitySwitch,
    staleTime: 5 * 60_000,
  });
  if (!user || isParentMode || enabled.data !== true) return null;
  return <Section userId={user.id} className={className} />;
}

function Section({ userId, className }: { userId: string; className: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const gate = useAvailabilityGate();
  const [quickOpen, setQuickOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Same query key as the posting gate, so both read one cached list.
  const mine = useQuery({
    queryKey: ["my-availabilities", userId],
    queryFn: () => listMyAvailabilities(),
    staleTime: 30_000,
  });
  const invitations = useQuery({
    queryKey: ["home-pending-invitations", userId],
    queryFn: async () =>
      (await listMyContactRequests("inbox")).filter((r) => r.status === "pending").length,
    staleTime: 60_000,
  });

  const summary = summarizeHomeAvailability((mine.data ?? []) as unknown as HomePost[]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-availabilities", userId] });

  const post = () => {
    if (gate.canPost) setQuickOpen(true);
    else void navigate({ to: "/players", search: { tab: "mine" } as never });
  };

  const stillAvailable = async (p: HomePost) => {
    setBusy(true);
    try {
      await reconfirmAvailability(p.id, p.status as never);
      toast.success("Thanks, you're listed for 2 more weeks");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update your availability");
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
              to="/players"
              search={{ tab: "mine" } as never}
              className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold"
            >
              My availability
            </Link>
            <button
              type="button"
              onClick={post}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-4 text-sm font-semibold"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add a time
            </button>
          </div>
        </div>
      )}

      <nav aria-label="Shortcuts" className="mt-3 grid grid-cols-4 gap-2">
        <Shortcut to="/players" icon={Users} label="Find players" />
        <Shortcut to="/discover" icon={Search} label="Find games" />
        <Shortcut to="/feed" search={{ joined: true }} icon={CalendarDays} label="My games" />
        <Shortcut
          to="/players"
          search={{ tab: "mine" }}
          icon={Mail}
          label="Invitations"
          count={pending}
        />
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
            void navigate({ to: "/players", search: { tab: "mine" } as never });
          }}
        />
      )}
    </section>
  );
}

function Shortcut({
  to,
  search,
  icon: Icon,
  label,
  count = 0,
}: {
  to: string;
  search?: Record<string, unknown>;
  icon: typeof Users;
  label: string;
  count?: number;
}) {
  const named = count > 0 ? `${label}, ${count} waiting` : label;
  return (
    <Link
      to={to as never}
      search={search as never}
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
