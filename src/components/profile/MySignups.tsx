import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, ClipboardList, Dumbbell, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  cancelTryoutRsvp,
  listMyTryoutSignups,
  type MyTryoutSignup,
} from "@/lib/tryouts.functions";
import { isLateCancel, lateCancelWarning, sessionStart } from "@/lib/cancel-window";
import {
  cancelTrainerSessionRequest,
  listMyTrainerRequests,
  type TrainerSessionRequest,
} from "@/lib/trainer-requests";

type Item = {
  key: string;
  icon: "tryout" | "session";
  title: string;
  subtitle: string;
  when: string | null;
  where: string | null;
  badge: string;
  to: { to: string; params?: Record<string, string> };
  /** Shown in the confirm dialog. */
  confirmText: string;
  /** Set when cancelling now would be late; the warning to show. */
  lateWarning: string | null;
  cancel: () => Promise<void>;
};

const fmt = (d: string | null) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

function sessionWhen(r: TrainerSessionRequest): string | null {
  if (!r.preferred_date) return null;
  const [y, m, d] = r.preferred_date.split("-").map(Number);
  const [hh, mm] = (r.preferred_start_time ?? "").split(":").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, hh || 0, mm || 0);
  return r.preferred_start_time
    ? fmt(dt.toISOString())
    : dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * One place for a player (or a parent, for their child) to see the tryouts,
 * camps and trainer sessions they've signed up for and cancel any of them.
 * Games are listed by the Pickup section below and cancel from there.
 */
export function MySignups() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const tryoutsFn = useServerFn(listMyTryoutSignups);
  const cancelTryout = useServerFn(cancelTryoutRsvp);
  const [target, setTarget] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);

  const tryouts = useQuery({
    queryKey: ["my-signups", "tryouts", user?.id ?? null],
    queryFn: () => tryoutsFn(),
    enabled: !!user,
  });
  const sessions = useQuery({
    queryKey: ["my-signups", "sessions", user?.id ?? null],
    enabled: !!user,
    queryFn: async () => {
      const rows = (await listMyTrainerRequests("outbox")).filter(
        (r) => r.status === "pending" || r.status === "accepted",
      );
      const ids = [...new Set(rows.map((r) => r.trainer_id))];
      type TrainerRow = {
        id: string;
        name: string;
        timezone: string | null;
        cancel_cutoff_min?: number | null;
      };
      const trainers = new Map<string, TrainerRow>();
      if (ids.length) {
        const { data } = await supabase.from("teams").select("*").in("id", ids);
        for (const t of (data ?? []) as TrainerRow[]) trainers.set(t.id, t);
      }
      return rows.map((r) => {
        const t = trainers.get(r.trainer_id);
        return {
          row: r,
          trainerName: t?.name ?? "Trainer",
          start: sessionStart(r.preferred_date, r.preferred_start_time, t?.timezone),
          cutoff: t?.cancel_cutoff_min ?? null,
        };
      });
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["my-signups"] });
    void qc.invalidateQueries({ queryKey: ["tryouts"] });
  };

  const items: Item[] = [
    ...(tryouts.data ?? []).map((t: MyTryoutSignup): Item => ({
      key: `tryout-${t.postId}-${t.attendeeId}`,
      icon: "tryout",
      title: t.title,
      subtitle: `${t.kind === "clinic" ? "Camp / clinic" : "Tryout"} · ${t.teamName}${t.isChild ? ` · ${t.attendeeName}` : ""}`,
      when: fmt(t.eventDate),
      where: t.location,
      badge: "Registered",
      to: { to: "/tryouts/$postId", params: { postId: t.postId } },
      lateWarning: isLateCancel(t.eventDate, t.cancelCutoffMin)
        ? lateCancelWarning(t.cancelCutoffMin)
        : null,
      confirmText: `${t.isChild ? `${t.attendeeName}'s` : "Your"} spot at ${t.title} will open up for someone else and ${t.teamName} will be told.${t.price ? " If you already paid the team, ask them about a refund." : ""}`,
      cancel: async () => {
        const r = await cancelTryout({
          data: { postId: t.postId, onBehalfOf: t.isChild ? t.attendeeId : null },
        });
        if (!r.ok) throw new Error(r.error);
      },
    })),
    ...(sessions.data ?? []).map(({ row, trainerName, start, cutoff }): Item => ({
      key: `session-${row.id}`,
      icon: "session",
      title: row.session_type || "Training session",
      subtitle: trainerName,
      when: sessionWhen(row),
      where: null,
      badge: row.status === "accepted" ? "Accepted" : "Pending",
      to: { to: "/trainers/$trainerId", params: { trainerId: row.trainer_id } },
      // A pending request isn't holding a slot yet, so it can't be late.
      lateWarning:
        row.status === "accepted" && isLateCancel(start, cutoff) ? lateCancelWarning(cutoff) : null,
      confirmText:
        row.status === "accepted"
          ? `${trainerName} will be told you cancelled and the time opens up for other players. If you already paid them, sort out any refund with them directly.`
          : `Your request to ${trainerName} will be withdrawn.`,
      cancel: () => cancelTrainerSessionRequest(row.id),
    })),
  ];

  if (!user || items.length === 0) return null;

  const run = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await target.cancel();
      toast.success("Cancelled.");
      setTarget(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6" aria-label="Tryouts, camps and sessions you've signed up for">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-2xl border border-lime/30 bg-lime/10 text-lime">
          <ClipboardList className="h-4 w-4" />
        </span>
        <div>
          <h2 className="section-eyebrow text-foreground">Tryouts, camps &amp; sessions</h2>
          <p className="text-[10px] text-muted-foreground">Things you've signed up for</p>
        </div>
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li
            key={it.key}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
              {it.icon === "session" ? (
                <Dumbbell className="h-4 w-4" />
              ) : (
                <CalendarClock className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                to={it.to.to as never}
                params={it.to.params as never}
                className="block truncate text-sm font-semibold hover:underline"
              >
                {it.title}
              </Link>
              <div className="truncate text-[11px] text-muted-foreground">{it.subtitle}</div>
              {(it.when || it.where) && (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  {it.when && <span>{it.when}</span>}
                  {it.where && (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" />
                      {it.where}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span className="rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[10px] font-bold text-lime">
                {it.badge}
              </span>
              <button
                type="button"
                onClick={() => setTarget(it)}
                className="text-xs font-semibold text-coral underline-offset-2 hover:underline"
              >
                Cancel
              </button>
            </div>
          </li>
        ))}
      </ul>

      <AlertDialog open={!!target} onOpenChange={(o) => !busy && !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {target?.title}?</AlertDialogTitle>
            <AlertDialogDescription>{target?.confirmText}</AlertDialogDescription>
          </AlertDialogHeader>
          {target?.lateWarning && (
            <p
              role="alert"
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-medium text-amber-500"
            >
              {target.lateWarning}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void run();
              }}
              className="bg-coral text-primary-foreground hover:bg-coral/90"
            >
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {busy ? "Cancelling…" : "Yes, cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
