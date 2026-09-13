import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import {
  downloadIcs,
  googleCalendarUrl,
  outlookCalendarUrl,
  type CalendarEvent,
} from "@/lib/datetime";

/** Add-to-calendar menu (Apple/Outlook/Google) built on the shared .ics logic. */
export function AddToCalendarButton({
  event,
  className = "",
}: {
  event: CalendarEvent;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const slug = event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-muted-foreground hover:border-lime/60 ${className}`}
      >
        <CalendarPlus className="size-3.5" />
        Add to calendar
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
          <a
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm hover:bg-background"
          >
            Google Calendar
          </a>
          <a
            href={outlookCalendarUrl(event)}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm hover:bg-background"
          >
            Outlook
          </a>
          <button
            type="button"
            onClick={() => {
              downloadIcs(event, `${slug || "event"}.ics`);
              setOpen(false);
            }}
            className="block w-full px-3 py-2.5 text-left text-sm hover:bg-background"
          >
            Apple / .ics file
          </button>
        </div>
      )}
    </div>
  );
}
