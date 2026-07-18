import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Calendar, Clock, MessageSquare, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import type { Org } from "@/lib/sample-data";
import { ensureOrgOwnerId } from "@/lib/org-store";
import {
  createTrainerSessionRequest,
  cancelTrainerSessionRequest,
  getMyPendingRequestForTrainer,
  type TrainerSessionRequest,
} from "@/lib/trainer-requests";
import { useAuth } from "@/hooks/use-auth";

type Mode = "form" | "existing" | "sent";

export function BookSessionSheet({
  org,
  open,
  onOpenChange,
  onStatusChange,
}: {
  org: Org;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onStatusChange?: () => void;
}) {
  const nav = useNavigate();
  const { user } = useAuth();
  const sessionTypes = useMemo(
    () => org.sessionTypes ?? ["1:1 Coaching", "Group Session", "Assessment"],
    [org.sessionTypes],
  );

  const [sessionType, setSessionType] = useState(sessionTypes[0]);
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState<"30" | "60" | "90">("60");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<Mode>("form");
  const [existing, setExisting] = useState<TrainerSessionRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  // On open, check for existing request
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setLoading(true);
    getMyPendingRequestForTrainer(org.id)
      .then((row) => {
        if (cancelled) return;
        if (row && (row.status === "pending" || row.status === "accepted")) {
          setExisting(row);
          setMode("existing");
        } else {
          setExisting(null);
          setMode("form");
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, user, org.id]);

  const reset = () => {
    setMode("form");
    setExisting(null);
    setMessage("");
    setDate("");
    setDuration("60");
    setSessionType(sessionTypes[0]);
    setSubmitting(false);
  };

  const submit = async () => {
    if (!user) {
      toast("Sign in to request a session");
      nav({ to: "/auth" });
      return;
    }
    setSubmitting(true);
    try {
      const ownerId = await ensureOrgOwnerId(org.id);
      if (!ownerId) throw new Error("Trainer profile not available. Try again shortly.");
      const row = await createTrainerSessionRequest({
        trainerId: org.id,
        toUserId: ownerId,
        sessionType,
        preferredDate: date || null,
        durationMinutes: Number(duration),
        message,
      });
      setExisting(row);
      setMode("sent");
      toast.success(`Request sent to ${org.name}`);
      onStatusChange?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send request");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!existing) return;
    setSubmitting(true);
    try {
      await cancelTrainerSessionRequest(existing.id);
      toast.success("Request cancelled");
      onStatusChange?.();
      onOpenChange(false);
      setTimeout(reset, 250);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not cancel request");
    } finally {
      setSubmitting(false);
    }
  };

  const statusMeta = (s: TrainerSessionRequest["status"]) => {
    switch (s) {
      case "pending":
        return { label: "Pending", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40", Icon: Loader2 };
      case "accepted":
        return { label: "Accepted", cls: "bg-lime/15 text-lime border-lime/40", Icon: CheckCircle2 };
      case "declined":
        return { label: "Declined", cls: "bg-rose-500/15 text-rose-300 border-rose-500/40", Icon: XCircle };
      case "cancelled":
        return { label: "Cancelled", cls: "bg-muted text-muted-foreground border-border", Icon: XCircle };
      case "completed":
        return { label: "Completed", cls: "bg-lime/15 text-lime border-lime/40", Icon: CheckCircle2 };
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setTimeout(reset, 250);
      }}
    >
      <SheetContent side="bottom" className="rounded-t-3xl border-border max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-xl">
            {mode === "sent" ? "Request sent" : mode === "existing" ? "Your request" : "Book a session"}
          </SheetTitle>
          <SheetDescription>
            {mode === "sent" ? (
              <>Your request is on its way to <span className="text-foreground font-semibold">{org.name}</span>. You'll be notified when they respond.</>
            ) : mode === "existing" && existing ? (
              <>You already have a {existing.status} request with <span className="text-foreground font-semibold">{org.name}</span>.</>
            ) : (
              <>Send a request to <span className="text-foreground font-semibold">{org.name}</span>. They'll confirm availability in your inbox.</>
            )}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="mt-8 flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : mode === "existing" && existing ? (
          <ExistingRequestView row={existing} statusMeta={statusMeta} />
        ) : mode === "sent" && existing ? (
          <ExistingRequestView row={existing} statusMeta={statusMeta} />
        ) : (
          <div className="mt-5 space-y-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Session type
              </div>
              <div className="flex flex-wrap gap-2">
                {sessionTypes.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSessionType(s)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                      sessionType === s
                        ? "border-lime bg-lime/15 text-lime"
                        : "border-border bg-surface text-muted-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> Preferred date
                </span>
                <input
                  type="date"
                  value={date}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime"
                />
              </label>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> Duration
                </span>
                <div className="flex gap-1.5">
                  {(["30", "60", "90"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={`flex-1 rounded-2xl border py-2.5 text-sm font-semibold transition-all ${
                        duration === d
                          ? "border-lime bg-lime/15 text-lime"
                          : "border-border bg-surface text-muted-foreground"
                      }`}
                    >
                      {d}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" /> Message
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 500))}
                placeholder="Share your goals, current level, and anything else that helps them prep."
                rows={4}
                className="w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime resize-none"
              />
              <span className="mt-1 block text-right text-[10px] text-muted-foreground">
                {message.length}/500
              </span>
            </label>

            {org.ratePerHour ? (
              <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
                Estimated cost:{" "}
                <span className="font-bold text-foreground">
                  ${Math.round((org.ratePerHour * Number(duration)) / 60)}
                </span>{" "}
                <span className="text-muted-foreground">
                  (${org.ratePerHour}/hr · {duration} min)
                </span>
              </div>
            ) : null}
          </div>
        )}

        <SheetFooter className="mt-5 gap-2 flex-row">
          {mode === "existing" && existing ? (
            <>
              <button
                onClick={() => onOpenChange(false)}
                className="flex-1 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold"
              >
                Close
              </button>
              {existing.status === "pending" ? (
                <button
                  onClick={cancel}
                  disabled={submitting}
                  className="flex-1 rounded-full border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-300 disabled:opacity-60"
                >
                  {submitting ? "Cancelling…" : "Cancel request"}
                </button>
              ) : (
                <button
                  onClick={() => {
                    onOpenChange(false);
                    nav({ to: "/inbox", search: { to: org.id } as never });
                  }}
                  className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime"
                >
                  Open chat
                </button>
              )}
            </>
          ) : mode === "sent" ? (
            <>
              <button
                onClick={() => onOpenChange(false)}
                className="flex-1 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold"
              >
                Done
              </button>
              <button
                onClick={() => {
                  onOpenChange(false);
                  nav({ to: "/inbox", search: { to: org.id } as never });
                }}
                className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime"
              >
                Message trainer
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onOpenChange(false)}
                className="flex-1 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Send request"}
              </button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ExistingRequestView({
  row,
  statusMeta,
}: {
  row: TrainerSessionRequest;
  statusMeta: (s: TrainerSessionRequest["status"]) => {
    label: string;
    cls: string;
    Icon: typeof CheckCircle2;
  };
}) {
  const meta = statusMeta(row.status);
  return (
    <div className="mt-5 space-y-3">
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${meta.cls}`}
      >
        <meta.Icon className={`h-3.5 w-3.5 ${row.status === "pending" ? "animate-spin" : ""}`} />
        {meta.label}
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4 space-y-2 text-sm">
        <Row label="Session" value={row.session_type} />
        <Row label="Duration" value={`${row.duration_minutes} min`} />
        {row.preferred_date ? (
          <Row
            label="Preferred date"
            value={new Date(row.preferred_date).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          />
        ) : null}
        {row.message ? <Row label="Your note" value={row.message} multiline /> : null}
        {row.responder_note ? (
          <Row label="Trainer note" value={row.responder_note} multiline />
        ) : null}
        <Row
          label="Sent"
          value={new Date(row.created_at).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        />
      </div>
    </div>
  );
}

function Row({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={multiline ? "" : "flex items-baseline justify-between gap-3"}>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm text-foreground ${multiline ? "mt-1 whitespace-pre-wrap" : "text-right"}`}>
        {value}
      </div>
    </div>
  );
}
