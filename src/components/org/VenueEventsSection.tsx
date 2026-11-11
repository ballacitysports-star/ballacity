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
import { createTrainerEvent, createVenueEvent } from "@/lib/venue-events.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EMPTY_VENUE_EVENT_DRAFT,
  buildVenueEventPayload,
  eventKindsFor,
  fetchEventWaiver,
  listVenueEvents,
  venueEventErrorMessage,
  venueEventKindLabel,
  type EventHostKind,
  type EventWaiver,
  type VenueEvent,
  type VenueEventDraft,
  type VenueEventKind,
  type VenueEventsClient,
} from "@/lib/venue-events";

const client = supabase as unknown as VenueEventsClient;

/** Trainer group sessions (slice F) have their own switch, off until released. */
export const TRAINER_EVENTS_SETTING_KEY = "trainer_events";

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

function CreateForm({
  hostKind,
  hostId,
  onDone,
}: {
  hostKind: EventHostKind;
  hostId: string;
  onDone: () => void;
}) {
  const createVenue = useServerFn(createVenueEvent);
  const createTrainer = useServerFn(createTrainerEvent);
  const kinds = eventKindsFor(hostKind);
  const [d, setD] = useState<VenueEventDraft>(EMPTY_VENUE_EVENT_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof VenueEventDraft) => (v: string) => setD((p) => ({ ...p, [k]: v }));
  const m = useMutation({
    mutationFn: async () => {
      const built = buildVenueEventPayload(d, new Date(), kinds);
      if (!built.ok) throw new Error(built.error);
      if (hostKind === "trainer") {
        const { kind } = built.payload;
        if (kind !== "clinic" && kind !== "camp") throw new Error("Pick a type.");
        return createTrainer({ data: { trainerId: hostId, event: { ...built.payload, kind } } });
      }
      return createVenue({ data: { orgId: hostId, event: built.payload } });
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
          {kinds.map((k) => (
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

function WaiverDialog({
  waiver,
  onCancel,
  onAccept,
  busy,
}: {
  waiver: EventWaiver | null;
  onCancel: () => void;
  onAccept: () => void;
  busy: boolean;
}) {
  const [agreed, setAgreed] = useState(false);
  return (
    <Dialog open={!!waiver} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{waiver?.title ?? "Waiver"}</DialogTitle>
          <DialogDescription>Read and accept the host&apos;s waiver to sign up.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border p-3 text-sm">
          {waiver?.content}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1"
          />
          I have read and accept this waiver.
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!agreed || busy} onClick={onAccept}>
            Accept and sign up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A venue's clinics, camps, tournaments and open gym (events stage 5), behind the venue_events
 * switch. Staff (owner and admins) can list one; members sign up through register_for_event.
 */
export function VenueEventsSection({ orgId, canPost }: { orgId: string; canPost: boolean }) {
  return <HostEventsSection hostKind="facility" hostId={orgId} canPost={canPost} />;
}

/**
 * A trainer's group clinics and camps (events stage 6, slice F), behind the trainer_events switch.
 * Sign-ups ask for the trainer's waiver, if it has one.
 */
export function TrainerEventsSection({
  trainerId,
  canPost,
}: {
  trainerId: string;
  canPost: boolean;
}) {
  return <HostEventsSection hostKind="trainer" hostId={trainerId} canPost={canPost} />;
}

function HostEventsSection({
  hostKind,
  hostId,
  canPost,
}: {
  hostKind: EventHostKind;
  hostId: string;
  canPost: boolean;
}) {
  const auth = useAuth();
  const qc = useQueryClient();
  const userId = auth.user?.id ?? null;
  const [creating, setCreating] = useState(false);
  const [waiverFor, setWaiverFor] = useState<{ eventId: string; waiver: EventWaiver } | null>(null);
  const switchKey = hostKind === "trainer" ? TRAINER_EVENTS_SETTING_KEY : VENUE_EVENTS_SETTING_KEY;
  const on = useQuery({
    queryKey: [`${hostKind}-events-switch`],
    queryFn: () => isAppSwitchOn(supabase as unknown as EventsClient, switchKey),
    staleTime: 5 * 60_000,
  });
  const q = useQuery({
    queryKey: ["host-events", hostKind, hostId, userId],
    queryFn: () => listVenueEvents(client, hostId, { userId, hostKind }),
    enabled: on.data === true,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["host-events", hostKind, hostId] });
    void qc.invalidateQueries({ queryKey: ["feed-events"] });
  };
  // A host with a published waiver: show it first; register_for_event signs it with the sign-up.
  const signUp = useMutation({
    mutationFn: async (v: { id: string; waiverId?: string }): Promise<"done" | "waiver"> => {
      if (!v.waiverId && hostKind !== "facility") {
        const waiver = await fetchEventWaiver(client, v.id);
        if (waiver && !waiver.signed) {
          setWaiverFor({ eventId: v.id, waiver });
          return "waiver";
        }
      }
      const { error } = await client.rpc(
        "register_for_event",
        v.waiverId
          ? { _event: v.id, _on_behalf_of: null, _waiver_id: v.waiverId, _attested: true }
          : { _event: v.id },
      );
      if (error) throw new Error(venueEventErrorMessage(error.message));
      return "done";
    },
    onSuccess: (r) => {
      if (r === "waiver") return;
      setWaiverFor(null);
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
    <section
      id={hostKind === "trainer" ? "trainer-events" : "venue-events"}
      className="rounded-2xl border border-border/60 bg-surface p-4"
    >
      <WaiverDialog
        key={waiverFor?.eventId ?? "none"}
        waiver={waiverFor?.waiver ?? null}
        busy={signUp.isPending}
        onCancel={() => setWaiverFor(null)}
        onAccept={() =>
          waiverFor && signUp.mutate({ id: waiverFor.eventId, waiverId: waiverFor.waiver.id })
        }
      />
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="section-title flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-lime" />{" "}
          {hostKind === "trainer" ? "Group clinics & camps" : "Clinics, camps & open gym"}
        </h2>
        {canPost && !creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> List an event
          </Button>
        )}
      </div>
      {canPost && creating && (
        <CreateForm
          hostKind={hostKind}
          hostId={hostId}
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
          {hostKind === "trainer"
            ? "List a group clinic or camp so players can sign up here."
            : "List a clinic, camp, tournament or open gym so players can sign up here."}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((ev) => (
            <EventItem
              key={ev.id}
              ev={ev}
              signedIn={!!userId}
              busy={
                (signUp.isPending && signUp.variables?.id === ev.id) ||
                (cancel.isPending && cancel.variables === ev.id)
              }
              onSignUp={() => signUp.mutate({ id: ev.id })}
              onCancel={() => cancel.mutate(ev.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
