import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Calendar, Clock, MessageSquare } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import type { Org } from "@/lib/sample-data";

export function BookSessionSheet({
  org,
  open,
  onOpenChange,
}: {
  org: Org;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const nav = useNavigate();
  const sessionTypes = org.sessionTypes ?? ["1:1 Coaching", "Group Session", "Assessment"];
  const [sessionType, setSessionType] = useState(sessionTypes[0]);
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState<"30" | "60" | "90">("60");
  const [message, setMessage] = useState("");

  const submit = () => {
    const summary = `Booking request: ${sessionType} · ${duration} min${date ? ` · ${date}` : ""}${message ? `\n\n${message}` : ""}`;
    toast.success(`Request sent to ${org.name}`);
    onOpenChange(false);
    // Continue conversation in inbox
    nav({ to: "/inbox", search: { to: org.id, prefill: summary } as never });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl border-border">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-xl">Book a session</SheetTitle>
          <SheetDescription>
            Send a request to <span className="text-foreground font-semibold">{org.name}</span>. They'll confirm availability in your inbox.
          </SheetDescription>
        </SheetHeader>

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
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Share your goals, current level, and anything else that helps them prep."
              rows={4}
              className="w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime resize-none"
            />
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

        <SheetFooter className="mt-5 gap-2 flex-row">
          <button
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime"
          >
            Send request
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
