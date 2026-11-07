import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, MapPin, Plus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VENUE_HIDDEN_LABEL } from "@/lib/post-venues";
import { isAppSwitchOn, type EventsClient } from "@/lib/events-read";
import { VENUE_EVENTS_SETTING_KEY } from "@/lib/feed-events";
import { blockedMessage } from "@/lib/post-moderation";
import { createVenueEvent } from "@/lib/venue-events.functions";
import {
  EMPTY_VENUE_EVENT_DRAFT,
  VENUE_EVENT_KINDS,
  buildVenueEventPayload,
  listVenueEvents,
  venueEventErrorMessage,
  venueEventKindLabel,
  type VenueEvent,
  type VenueEventDraft,
  type VenueEventKind,
  type VenueEventsClient,
} from "@/lib/venue-events";

const client = supabase as unknown as VenueEventsClient;

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

function EventItem({
  ev,
  signedIn,
  onSignUp,
  onCancel,
  busy,
}: {
  ev: VenueEvent;
  signedIn: boolean;
  onSignUp: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const left = ev.spotsMax == null ? null : Math.max(ev.spotsMax - ev.spotsTaken, 0);
  const listed = ev.status === "approved";
  return (
    <li className="rounded-xl border border-border/50 bg-background p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-lime">
        {venueEventKindLabel(ev.kind)} · Ages {ev.minAge}–{ev.maxAge}
        {!listed && (
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {ev.status === "held" ? "Held for review" : "Awaiting review"}
          </span>
        )}
      </div>
      <div className="mt-1 font-semibold">{ev.title}</div>
      {ev.body && <p className="mt-1 text-sm text-muted-foreground">{ev.body}</p>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {when(ev.startsAt)}
        </span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {ev.venueHidden ? VENUE_HIDDEN_LABEL : (ev.location ?? "At this venue")}
        </span>
        {left != null && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden /> {left} of {ev.spotsMax} spots left
          </span>
        )}
        {ev.price != null && <span>{ev.price === 0 ? "Free" : `$${ev.price}`}</span>}
      </div>
      {listed && signedIn && (
        <div className="mt-3">
          {ev.registered ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
              Cancel sign-up
            </Button>
          ) : (
            <Button size="sm" disabled={busy || left === 0} onClick={onSignUp}>
              {left === 0 ? "Full" : "Sign up"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function CreateForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const create = useServerFn(createVenueEvent);
  const [d, setD] = useState<VenueEventDraft>(EMPTY_VENUE_EVENT_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof VenueEventDraft) => (v: string) => setD((p) => ({ ...p, [k]: v }));
  const m = useMutation({
    mutationFn: async () => {
      const built = buildVenueEventPayload(d);
      if (!built.ok) throw new Error(built.error);
      return create({ data: { orgId, event: built.payload } });
    },
    onSuccess: (r) => {
      toast.success(
        r.held ? "Saved. It will be listed once a moderator reviews it." : "Event listed.",
      );
      setD(EMPTY_VENUE_EVENT_DRAFT);
      onDone();
    },
    onError: (e) => setError(blockedMessage(e) ?? (e instanceof Error ? e.message : String(e))),
  });

  const field = (id: keyof VenueEventDraft, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`ve-${id}`}>{label}</Label>
      <Input id={`ve-${id}`} value={d[id]} onChange={(e) => set(id)(e.target.value)} {...props} />
    </div>
  );

  return (
    <form
      className="mb-3 space-y-3 rounded-xl border border-border/50 bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        m.mutate();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="ve-kind">Type</Label>
        <select
          id="ve-kind"
          value={d.kind}
          onChange={(e) => setD((p) => ({ ...p, kind: e.target.value as VenueEventKind }))}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {VENUE_EVENT_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      {field("title", "Title", { maxLength: 200, required: true })}
      <div className="space-y-1">
        <Label htmlFor="ve-body">Description</Label>
        <Textarea
          id="ve-body"
          value={d.body}
          maxLength={5000}
          onChange={(e) => set("body")(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field("startsAt", "Starts", { type: "datetime-local", required: true })}
        {field("endsAt", "Ends (optional)", { type: "datetime-local" })}
        {field("minAge", "Youngest age", { inputMode: "numeric", required: true })}
        {field("maxAge", "Oldest age", { inputMode: "numeric", required: true })}
        {field("price", "Price in $ (empty = free)", { inputMode: "decimal" })}
        {field("capacity", "Spots (empty = no limit)", { inputMode: "numeric" })}
      </div>
      {field("address", "Address (hidden from those who may not see a youth event's venue)", {
        maxLength: 300,
      })}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={m.isPending}>
          {m.isPending ? "Saving…" : "List event"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * A venue's clinics, camps, tournaments and open gym (events stage 5), behind the venue_events
 * switch. Staff (owner and admins) can list one; members sign up through register_for_event.
 */
export function VenueEventsSection({ orgId, canPost }: { orgId: string; canPost: boolean }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const userId = auth.user?.id ?? null;
  const [creating, setCreating] = useState(false);
  const on = useQuery({
    queryKey: ["venue-events-switch"],
    queryFn: () => isAppSwitchOn(supabase as unknown as EventsClient, VENUE_EVENTS_SETTING_KEY),
    staleTime: 5 * 60_000,
  });
  const q = useQuery({
    queryKey: ["venue-events", orgId, userId],
    queryFn: () => listVenueEvents(client, orgId, { userId }),
    enabled: on.data === true,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["venue-events", orgId] });
    void qc.invalidateQueries({ queryKey: ["feed-events"] });
  };
  const signUp = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.rpc("register_for_event", { _event: id });
      if (error) throw new Error(venueEventErrorMessage(error.message));
    },
    onSuccess: () => {
      toast.success("You're signed up.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.rpc("cancel_event_registration", { _event: id });
      if (error) throw new Error(venueEventErrorMessage(error.message));
    },
    onSuccess: () => {
      toast.success("Sign-up cancelled.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (on.data !== true) return null;
  const items = q.data ?? [];
  if (!canPost && !q.isLoading && !q.isError && items.length === 0) return null;

  return (
    <section id="venue-events" className="rounded-2xl border border-border/60 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="section-title flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-lime" /> Clinics, camps &amp; open gym
        </h2>
        {canPost && !creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> List an event
          </Button>
        )}
      </div>
      {canPost && creating && (
        <CreateForm
          orgId={orgId}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
      {q.isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-background" aria-busy="true" />
      ) : q.isError ? (
        <p className="text-xs text-muted-foreground">Couldn&apos;t load events.</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          List a clinic, camp, tournament or open gym so players can sign up here.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((ev) => (
            <EventItem
              key={ev.id}
              ev={ev}
              signedIn={!!userId}
              busy={
                (signUp.isPending && signUp.variables === ev.id) ||
                (cancel.isPending && cancel.variables === ev.id)
              }
              onSignUp={() => signUp.mutate(ev.id)}
              onCancel={() => cancel.mutate(ev.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
