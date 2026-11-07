import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, CalendarClock, MapPin, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/ui/empty-state";
import { VENUE_HIDDEN_LABEL } from "@/lib/post-venues";
import {
  FEED_EVENT_KIND_LABEL,
  feedTypes,
  listFeedEvents,
  type FeedEvent,
  type FeedEventKind,
  type FeedEventsClient,
  type FeedType,
} from "@/lib/feed-events";

/** All · Pickup · Tryouts · Clinics (· Camps · Tournaments · Open gym). A radio group: one type at a time. */
export function FeedTypeChips({
  value,
  onChange,
  venueEventsOn = false,
}: {
  value: FeedType;
  onChange: (t: FeedType) => void;
  venueEventsOn?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="What to show" className="mb-3 flex gap-2 overflow-x-auto">
      {feedTypes(venueEventsOn).map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={value === t.id}
          onClick={() => onChange(t.id)}
          className={`min-h-9 shrink-0 rounded-full border px-4 text-sm font-semibold ${
            value === t.id
              ? "border-lime bg-lime text-primary-foreground"
              : "border-border bg-surface text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const EMPTY_NOUN: Record<FeedEventKind, string> = {
  tryout: "tryouts",
  clinic: "clinics",
  camp: "camps",
  tournament: "tournaments",
  open_gym: "open gym sessions",
};

function when(iso: string | null): string {
  if (!iso) return "Date to be announced";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EventCard({ ev }: { ev: FeedEvent }) {
  const body = (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-lime">
        {FEED_EVENT_KIND_LABEL[ev.kind] ?? "Event"} · {ev.hostName}
        {ev.orgId && ev.hostVerified && (
          <BadgeCheck
            className="ml-1 inline h-3.5 w-3.5 align-[-2px]"
            aria-label="Verified venue"
          />
        )}
      </div>
      <div className="mt-1 font-semibold">{ev.title}</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {when(ev.startsAt)}
        </span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {ev.venueHidden ? VENUE_HIDDEN_LABEL : (ev.location ?? "Venue to be announced")}
        </span>
        {ev.spotsMax != null && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {Math.max(ev.spotsMax - ev.spotsTaken, 0)} of {ev.spotsMax} spots left
          </span>
        )}
        {ev.price != null && <span>{ev.price === 0 ? "Free" : `$${ev.price}`}</span>}
      </div>
    </div>
  );
  if (ev.postId)
    return (
      <Link to="/tryouts/$postId" params={{ postId: ev.postId }} className="block">
        {body}
      </Link>
    );
  if (ev.orgId)
    return (
      <Link to="/orgs/$orgId" params={{ orgId: ev.orgId }} className="block">
        {body}
      </Link>
    );
  if (ev.teamId)
    return (
      <Link to="/teams/$teamId/events" params={{ teamId: ev.teamId }} className="block">
        {body}
      </Link>
    );
  return body;
}

/** Upcoming tryouts and/or clinics. `limit` keeps the All view's strip short. */
export function FeedEventsList({
  kinds,
  sports,
  limit,
  heading,
}: {
  kinds: FeedEventKind[];
  sports: string[];
  limit?: number;
  heading?: string;
}) {
  const q = useQuery({
    queryKey: ["feed-events", kinds.join(","), sports.join(","), limit ?? 0],
    queryFn: () =>
      listFeedEvents(supabase as unknown as FeedEventsClient, kinds, {
        sports,
        limit: limit ?? 50,
      }),
  });
  const items = q.data ?? [];
  if (limit && (q.isLoading || q.isError || items.length === 0)) return null; // the All strip stays quiet
  return (
    <section className="mb-4" aria-label={heading ?? "Events"}>
      {heading && <h2 className="section-eyebrow mb-2 text-muted-foreground">{heading}</h2>}
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.isError ? (
        <p className="text-sm text-muted-foreground">Couldn't load events. Try again soon.</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" aria-hidden />}
          title={
            kinds.length === 1 ? `No upcoming ${EMPTY_NOUN[kinds[0]]}` : "Nothing coming up yet"
          }
          description="Follow teams and venues to hear about new ones first."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((ev) => (
            <li key={ev.id}>
              <EventCard ev={ev} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
