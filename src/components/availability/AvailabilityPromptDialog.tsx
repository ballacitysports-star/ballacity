import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";

/** Dismissible inline banner for team game management surfaces. */
export function AvailabilityPromptBanner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-border bg-surface/60 p-4 text-sm ${className}`}
      role="status"
    >
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">Add your player availability</p>
          <p className="mt-1 text-muted-foreground">
            Your player profile has no open availability post yet. Adding one lets other hosts find
            you when you're free to play.
          </p>
          <Link
            to="/players"
            search={{ tab: "mine" }}
            className="mt-3 inline-flex rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground"
          >
            Add my availability
          </Link>
        </div>
      </div>
    </div>
  );
}
