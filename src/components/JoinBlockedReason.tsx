import { Lock, Users, PlayCircle, CalendarX } from "lucide-react";
import type { JoinGate } from "@/lib/live-status";

function iconFor(state: JoinGate["joinState"]) {
  switch (state) {
    case "roster_full":
      return Users;
    case "in_progress":
      return PlayCircle;
    case "completed":
      return CalendarX;
    default:
      return Lock;
  }
}

/** Inline explanation of why joining is blocked. Renders nothing when open. */
export function JoinBlockedReason({
  gate,
  className = "",
  waitlistHint = false,
}: {
  gate: JoinGate;
  className?: string;
  /** Append where waitlist spots show up once the viewer signs up. */
  waitlistHint?: boolean;
}) {
  if (!gate.locked || !gate.reason) return null;
  const Icon = iconFor(gate.joinState);
  return (
    <p
      className={`flex items-start gap-1.5 text-[11px] font-medium text-muted-foreground ${className}`}
      role="status"
    >
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="font-semibold text-foreground">Can’t join:</span> {gate.reason}
        {waitlistHint && gate.waitlistOpen && (
          <>
            {" "}
            Join the waitlist and your spot shows under “Positions needed” on the game page — the
            host sees you there if a spot opens.
          </>
        )}
      </span>
    </p>
  );
}
