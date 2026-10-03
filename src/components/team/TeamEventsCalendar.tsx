import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, FileSignature, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dateKeyInZone, monthGridKeys, monthLabel, WEEKDAY_LABELS } from "@/lib/datetime";

export type CalendarEvent = {
  id: string;
  title: string;
  kind: "tryout" | "clinic";
  event_date: string | null;
  spots_taken: number | null;
};
export type EventWaiverSummary = { going: number; signed: number };

export function groupCalendarEvents<T extends CalendarEvent>(events: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const event of events) {
    const key = event.event_date ? dateKeyInZone(event.event_date) : "";
    const day = grouped.get(key) ?? [];
    day.push(event);
    grouped.set(key, day);
  }
  return grouped;
}

export function EventWaiverStatus({ summary, required, loading, error }: {
  summary?: EventWaiverSummary;
  required: boolean;
  loading: boolean;
  error: boolean;
}) {
  return (
    <p className={`flex flex-wrap items-center gap-2 text-xs ${required && summary && summary.signed < summary.going ? "text-coral" : "text-muted-foreground"}`}>
      <FileSignature className="h-4 w-4 shrink-0" />
      {error ? "Waiver status unavailable" : loading ? "Loading waivers…" : !required ? "No waiver published" : !summary ? "Waiver status unavailable" : `${summary.signed}/${summary.going} waivers signed${summary.signed < summary.going ? ` · ${summary.going - summary.signed} missing` : ""}`}
    </p>
  );
}

export function TeamEventsCalendar<T extends CalendarEvent>({ events, summaries, waiverRequired, summaryLoading, summaryError, renderEvent }: {
  events: T[];
  summaries: Map<string, EventWaiverSummary>;
  waiverRequired: boolean;
  summaryLoading: boolean;
  summaryError: boolean;
  renderEvent: (event: T) => ReactNode;
}) {
  const today = dateKeyInZone(new Date());
  const [selected, setSelected] = useState(today);
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const grouped = groupCalendarEvents(events);
  const cells = monthGridKeys(cursor.year, cursor.month);
  const monthEvents = cells.flatMap((key) => key ? grouped.get(key) ?? [] : []);
  const going = monthEvents.reduce((total, event) => total + (summaries.get(event.id)?.going ?? event.spots_taken ?? 0), 0);
  const signed = monthEvents.reduce((total, event) => total + (summaries.get(event.id)?.signed ?? 0), 0);
  const dayEvents = grouped.get(selected) ?? [];
  const undated = grouped.get("") ?? [];
  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
    const year = next.getUTCFullYear();
    const month = next.getUTCMonth();
    setCursor({ year, month });
    setSelected(`${year}-${String(month + 1).padStart(2, "0")}-01`);
  };

  return (
    <section aria-label="Team events calendar" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold" aria-live="polite">{monthLabel(cursor.year, cursor.month)}</h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => {
            setSelected(today);
            setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 });
          }}>Today</Button>
          <Button variant="ghost" size="icon" aria-label="Previous month" title="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft /></Button>
          <Button variant="ghost" size="icon" aria-label="Next month" title="Next month" onClick={() => shiftMonth(1)}><ChevronRight /></Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-y border-border py-3 text-sm">
        <span className="font-semibold">{monthEvents.length} events</span>
        <span className="inline-flex items-center gap-1.5"><Users className="size-4 text-muted-foreground" />{going} RSVPs</span>
        <EventWaiverStatus summary={{ going, signed }} required={waiverRequired} loading={summaryLoading} error={summaryError} />
      </div>
      <div className="grid grid-cols-7" role="group" aria-label={monthLabel(cursor.year, cursor.month)}>
        {WEEKDAY_LABELS.map((day) => <span key={day} className="pb-2 text-center text-[11px] font-bold text-muted-foreground">{day}</span>)}
        {cells.map((key, index) => {
          if (!key) return <div key={`empty-${index}`} className="h-20 border-b border-border sm:h-28" />;
          const entries = grouped.get(key) ?? [];
          const rsvps = entries.reduce((n, e) => n + (summaries.get(e.id)?.going ?? e.spots_taken ?? 0), 0);
          const missing = entries.reduce((n, e) => {
            const summary = summaries.get(e.id);
            return n + (summary ? summary.going - summary.signed : 0);
          }, 0);
          return <Button key={key} variant="ghost" aria-pressed={selected === key} aria-current={today === key ? "date" : undefined}
            aria-label={`${key}, ${entries.length} events${entries.length ? `, ${rsvps} RSVPs${waiverRequired && !summaryLoading && !summaryError ? `, ${missing} missing waivers` : ""}` : ""}`}
            onClick={() => setSelected(key)}
            className={`h-20 min-w-0 flex-col justify-start gap-1 overflow-hidden whitespace-normal rounded-none border-b border-border px-0.5 py-2 sm:h-28 sm:px-2 ${selected === key ? "bg-accent ring-1 ring-inset ring-primary" : ""}`}>
            <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${key === today ? "bg-primary text-primary-foreground" : ""}`}>{Number(key.slice(8, 10))}</span>
            {entries.length > 0 && <>
              <span className="hidden w-full truncate text-left text-[11px] font-semibold sm:block">{entries[0].title}</span>
              <span className="text-[10px] font-semibold text-lime sm:hidden">{entries.length} {entries.length === 1 ? "event" : "events"}</span>
              <span className="text-[10px] text-muted-foreground">{rsvps} going{entries.length > 1 ? ` · +${entries.length - 1}` : ""}</span>
              {waiverRequired && missing > 0 && !summaryLoading && !summaryError && <span className="hidden text-[10px] text-coral sm:block">{missing} unsigned</span>}
            </>}
          </Button>;
        })}
      </div>
      {monthEvents.length === 0 && <p className="text-sm text-muted-foreground">No events scheduled this month.</p>}
      <div className="space-y-3" aria-live="polite">
        <h3 className="text-sm font-bold">{new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {dayEvents.length} events</h3>
        {dayEvents.length ? <ul className="space-y-3">{dayEvents.map(renderEvent)}</ul> : <p className="text-sm text-muted-foreground">No events on this day.</p>}
      </div>
      {undated.length > 0 && <div className="space-y-3"><h3 className="section-eyebrow text-muted-foreground">Date TBA · {undated.length}</h3><ul className="space-y-3">{undated.map(renderEvent)}</ul></div>}
    </section>
  );
}