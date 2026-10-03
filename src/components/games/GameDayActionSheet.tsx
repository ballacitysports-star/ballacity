import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, DollarSign, Megaphone, UserCheck, UserX, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { LiveParticipant } from "@/lib/game-roster";
import { listHostSubmissions, type PaymentSubmission } from "@/lib/payments";
import { createNotification } from "@/lib/notifications";

type Props = {
  gameId: string;
  gameTitle: string;
  startsAt: string;
  isPaid: boolean;
  hostId: string;
  roster: LiveParticipant[];
  busyId: string | null;
  onMarkAttendance: (playerId: string, attended: boolean) => void;
};

const MAX_BROADCAST = 280;

/** Host-only sticky game-day checklist: check-in, unpaid players, roster broadcast. */
export function GameDayActionSheet({
  gameId,
  gameTitle,
  startsAt,
  isPaid,
  hostId,
  roster,
  busyId,
  onMarkAttendance,
}: Props) {
  const [open, setOpen] = useState(true);
  const [subs, setSubs] = useState<PaymentSubmission[]>([]);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const players = useMemo(() => roster.filter((p) => p.userId !== hostId), [roster, hostId]);
  const started = Date.now() >= new Date(startsAt).getTime();

  useEffect(() => {
    if (!isPaid) return;
    let alive = true;
    const load = () =>
      listHostSubmissions()
        .then((all) => alive && setSubs(all.filter((s) => s.game_id === gameId)))
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [gameId, isPaid]);

  const payStatus = useMemo(() => {
    const m = new Map<string, PaymentSubmission["status"]>();
    for (const s of subs) if (!m.has(s.player_id)) m.set(s.player_id, s.status);
    return m;
  }, [subs]);

  const unpaid = isPaid ? players.filter((p) => payStatus.get(p.userId) !== "verified") : [];
  const checkedIn = players.filter((p) => p.attended !== null).length;

  const broadcast = async () => {
    const text = msg.trim();
    if (!text || players.length === 0) return;
    setSending(true);
    try {
      await Promise.all(
        players.map((p) =>
          createNotification({
            user_id: p.userId,
            type: "game_broadcast",
            title: `Host update · ${gameTitle}`.slice(0, 200),
            body: text,
            link: `/games/${gameId}`,
          }),
        ),
      );
      toast.success(`Sent to ${players.length} player${players.length === 1 ? "" : "s"}.`);
      setMsg("");
    } finally {
      setSending(false);
    }
  };

  const remindUnpaid = async () => {
    await Promise.all(
      unpaid.map((p) =>
        createNotification({
          user_id: p.userId,
          type: "payment_reminder",
          title: `Payment reminder · ${gameTitle}`.slice(0, 200),
          body: "Please send your game fee and submit proof before kickoff.",
          link: `/games/${gameId}/pay`,
        }),
      ),
    );
    toast.success(`Reminded ${unpaid.length} player${unpaid.length === 1 ? "" : "s"}.`);
  };

  const Step = ({ done, label, detail }: { done: boolean; label: string; detail: string }) => (
    <div className="flex items-center gap-2 text-xs">
      {done ? <CheckCircle2 className="h-4 w-4 text-lime" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
      <span className="font-semibold">{label}</span>
      <span className="ml-auto text-muted-foreground">{detail}</span>
    </div>
  );

  return (
    <section
      aria-label="Game-day checklist"
      className="sticky top-2 z-20 rounded-2xl border border-lime/30 bg-surface/95 p-3 shadow-lg backdrop-blur"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="font-bold text-sm">Game day</span>
        <span className="text-[11px] text-muted-foreground">
          {checkedIn}/{players.length} checked in{isPaid ? ` · ${unpaid.length} unpaid` : ""}
        </span>
        <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Step
              done={players.length > 0 && checkedIn === players.length}
              label="Check in players"
              detail={started ? `${checkedIn}/${players.length}` : "Opens at kickoff"}
            />
            {isPaid && (
              <Step done={unpaid.length === 0} label="Collect payments" detail={`${unpaid.length} unpaid`} />
            )}
          </div>

          {players.length > 0 && (
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl bg-background p-2">
              {players.map((p) => {
                const st = payStatus.get(p.userId);
                return (
                  <div key={p.userId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">{p.displayName}</span>
                    {isPaid && st !== "verified" && (
                      <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[10px] font-bold text-coral">
                        {st === "pending" ? "Proof to review" : "Unpaid"}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Check in ${p.displayName}`}
                      aria-pressed={p.attended === true}
                      disabled={!started || busyId === p.userId}
                      onClick={() => onMarkAttendance(p.userId, true)}
                      className={`rounded-full border p-1.5 disabled:opacity-40 ${
                        p.attended === true ? "border-lime/40 bg-lime/10 text-lime" : "border-border text-muted-foreground"
                      }`}
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Mark ${p.displayName} as a no-show`}
                      aria-pressed={p.attended === false}
                      disabled={!started || busyId === p.userId}
                      onClick={() => onMarkAttendance(p.userId, false)}
                      className={`rounded-full border p-1.5 disabled:opacity-40 ${
                        p.attended === false ? "border-coral/40 bg-coral/10 text-coral" : "border-border text-muted-foreground"
                      }`}
                    >
                      <UserX className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {isPaid && unpaid.length > 0 && (
            <button
              type="button"
              onClick={() => void remindUnpaid()}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-xs font-bold"
            >
              <DollarSign className="h-3.5 w-3.5" /> Remind {unpaid.length} unpaid
            </button>
          )}

          <div className="space-y-1.5">
            <textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value.slice(0, MAX_BROADCAST))}
              rows={2}
              placeholder="Message the roster: running late, moved to court 2…"
              aria-label="Message to everyone on the roster"
              className="w-full resize-none rounded-xl border border-border bg-background p-2 text-xs"
            />
            <button
              type="button"
              disabled={sending || !msg.trim() || players.length === 0}
              onClick={() => void broadcast()}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-lime-gradient py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              <Megaphone className="h-3.5 w-3.5" /> Send to {players.length} player{players.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
