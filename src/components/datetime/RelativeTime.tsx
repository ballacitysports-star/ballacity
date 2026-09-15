import { useEffect, useState } from "react";
import {
  formatCountdown,
  formatEventWhen,
  formatWhenStatus,
  viewerTimeNote,
  type EventWhen,
} from "@/lib/datetime";

/** Live-ticking countdown to an instant. Renders nothing once it has passed. */
export function Countdown({ at, className }: { at: string; className?: string }) {
  const [label, setLabel] = useState(() => formatCountdown(at));
  useEffect(() => {
    setLabel(formatCountdown(at));
    const id = setInterval(() => setLabel(formatCountdown(at)), 30_000);
    return () => clearInterval(id);
  }, [at]);
  if (!label) return null;
  return <span className={className}>{label}</span>;
}

/**
 * The standard "when" block: the event-timezone line, plus a viewer-timezone
 * hint when the two differ, plus optional live status.
 */
export function WhenBlock({
  when,
  withStatus = false,
  className = "",
}: {
  when: EventWhen;
  withStatus?: boolean;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const note = mounted ? viewerTimeNote(when) : "";

  return (
    <div className={className}>
      <p className="text-sm font-semibold">{formatEventWhen(when)}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
      {withStatus && (
        <p className="text-[11px] font-semibold text-muted-foreground">{formatWhenStatus(when)}</p>
      )}
      {!!when.arriveEarlyMin && (
        <p className="text-[11px] text-muted-foreground">Arrive {when.arriveEarlyMin} min early</p>
      )}
    </div>
  );
}
