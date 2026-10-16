import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CalendarClock, CalendarDays, List, Loader2, MapPin, Pencil, Plus, Shield, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { blockedMessage, heldNotice } from "@/lib/post-moderation";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTeamPermissions, useTeamRoster } from "@/lib/team-roster";
import { createTeamPost, deleteTeamPost, updateTeamPost } from "@/lib/team-posts.functions";
import { getTeamRosterOverview } from "@/lib/tryouts.functions";
import { TeamEventsCalendar, EventWaiverStatus } from "@/components/team/TeamEventsCalendar";
import { EventAvailabilitySummary } from "@/components/team/EventAvailabilitySummary";

export const Route = createFileRoute("/teams/$teamId/events")({
  head: () =>
    pageHead({
      title: "Tryouts & camps — BallaCity",
      description: "Manage team tryouts and camps with a calendar of events, RSVPs, roster availability and signed waivers.",
      noindex: true,
    }),
  ssr: false,
  component: TeamEventsPage,
});

type EventRow = {
  id: string;
  kind: "tryout" | "clinic";
  title: string;
  body: string | null;
  event_date: string | null;
  location: string | null;
  price: number | null;
  spots_max: number | null;
  spots_taken: number | null;
};

const KIND_LABEL = { tryout: "Tryout", clinic: "Camp / Clinic" } as const;

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function TeamEventsPage() {
  const { teamId } = Route.useParams();
  const roster = useTeamRoster(teamId);
  const perms = useTeamPermissions(teamId);
  const qc = useQueryClient();
  const del = useServerFn(deleteTeamPost);
  const [editing, setEditing] = useState<EventRow | "new" | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const overviewFn = useServerFn(getTeamRosterOverview);
  const overview = useQuery({
    queryKey: ["team-roster-overview", teamId],
    queryFn: () => overviewFn({ data: { teamId } }),
    enabled: perms.canInvite,
    refetchInterval: 20_000,
  });
  const availabilityByEvent = new Map((overview.data?.events ?? []).map((event) => [event.id, event.availability]));
  const summaries = new Map((overview.data?.events ?? []).map((event) => {
    const registered = event.rsvps.filter((rsvp) => rsvp.status === "registered");
    return [event.id, { going: registered.length, signed: registered.filter((rsvp) => rsvp.waiver).length }];
  }));

  const team = useQuery({
    queryKey: ["team-name", teamId],
    queryFn: async () => (await supabase.from("teams").select("id,name").eq("id", teamId).maybeSingle()).data,
  });
  const key = ["team-events", teamId];
  const events = useQuery({
    queryKey: key,
    refetchInterval: 20_000, // keeps spots/RSVP counts live
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_posts")
        .select("id,kind,title,body,event_date,location,price,spots_max,spots_taken")
        .eq("team_id", teamId)
        .in("kind", ["tryout", "clinic"])
        .order("event_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  if (roster.isLoading || team.isLoading)
    return (
      <div className="page-shell-prose pt-24 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );

  if (!perms.canInvite)
    return (
      <div className="page-shell-prose pt-24 text-center">
        <Shield className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Only this team's owner, managers and coaches can post events.</p>
        <Link to="/teams/$teamId" params={{ teamId }} className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground">
          Back to the team
        </Link>
      </div>
    );

  const now = Date.now();
  const all = events.data ?? [];
  const upcoming = all.filter((e) => !e.event_date || new Date(e.event_date).getTime() >= now);
  const past = all.filter((e) => e.event_date && new Date(e.event_date).getTime() < now).reverse();
  const teamName = team.data?.name ?? "your team";

  const remove = async (e: EventRow) => {
    if (!confirm(`Delete "${e.title}"? Registrations for it will be removed.`)) return;
    try {
      await del({ data: { id: e.id } });
      toast.success("Event deleted");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["team-roster-overview", teamId] });
    } catch {
      toast.error("Couldn't delete the event.");
    }
  };

  const Card = ({ e }: { e: EventRow }) => {
    const going = summaries.get(e.id)?.going ?? e.spots_taken ?? 0;
    const left = e.spots_max != null ? Math.max(e.spots_max - going, 0) : null;
    return (
      <li className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="rounded-full bg-lime/15 px-2 py-0.5 text-[11px] font-bold text-lime">{KIND_LABEL[e.kind]}</span>
            <p className="mt-2 font-semibold">{e.title}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(e)}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => remove(e)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />{e.event_date ? new Date(e.event_date).toLocaleString() : "Date TBA"}</p>
          {e.location && <p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{e.location}</p>}
          <p className="flex items-center gap-2"><Users className="h-4 w-4" />{going} going{e.spots_max ? ` · ${left} spots left` : ""} · {e.price ? `$${e.price}` : "Free"}</p>
          <EventWaiverStatus summary={summaries.get(e.id)} required={!!overview.data?.waiverVersion} loading={overview.isPending} error={overview.isError} />
          {overview.data && <EventAvailabilitySummary members={overview.data.members} answers={availabilityByEvent.get(e.id) ?? []} />}
        </div>
      </li>
    );
  };

  return (
    <div className="page-shell-prose space-y-5 pb-24 pt-4">
      <Link to="/teams/$teamId/manage" params={{ teamId }} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Manage {teamName}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Tryouts &amp; camps</h1>
          <p className="page-subtitle">Announce events for {teamName}. Upcoming ones also show on the home page.</p>
        </div>
        <Button onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" /> New event</Button>
      </header>

      <div className="flex items-center gap-1 border-b border-border pb-3" role="group" aria-label="Event view">
        <Button size="sm" variant={view === "calendar" ? "default" : "ghost"} aria-pressed={view === "calendar"} onClick={() => setView("calendar")}><CalendarDays />Calendar</Button>
        <Button size="sm" variant={view === "list" ? "default" : "ghost"} aria-pressed={view === "list"} onClick={() => setView("list")}><List />List</Button>
      </div>
      {events.isError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-coral">Couldn't load events.<Button variant="outline" size="sm" onClick={() => events.refetch()}>Retry</Button></div> : view === "calendar" ? (
        events.isPending ? <p className="text-sm text-muted-foreground">Loading events…</p> : <TeamEventsCalendar events={all} summaries={summaries} waiverRequired={!!overview.data?.waiverVersion} summaryLoading={overview.isPending} summaryError={overview.isError} renderEvent={(e) => <Card key={e.id} e={e} />} />
      ) : <><section>
        <h2 className="mb-3 flex items-center gap-2 section-eyebrow text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-lime" /> Upcoming · {upcoming.length}
        </h2>
        {events.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : upcoming.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No upcoming events. Post your first tryout or camp.</p>
        ) : (
          <ul className="space-y-3">{upcoming.map((e) => <Card key={e.id} e={e} />)}</ul>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <button type="button" className="section-eyebrow text-muted-foreground hover:text-foreground" onClick={() => setShowPast((v) => !v)}>
            {showPast ? "Hide" : "Show"} past events · {past.length}
          </button>
          {showPast && <ul className="mt-3 space-y-3 opacity-70">{past.map((e) => <Card key={e.id} e={e} />)}</ul>}
        </section>
      )}
      </>}
      {overview.isError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">Couldn't load RSVP and waiver details.<Button variant="outline" size="sm" onClick={() => overview.refetch()}>Retry details</Button></div>}

      {editing && (
        <EventDialog
          teamId={teamId}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: key });
            qc.invalidateQueries({ queryKey: ["tryouts", "upcoming"] });
            qc.invalidateQueries({ queryKey: ["team-roster-overview", teamId] });
          }}
        />
      )}
    </div>
  );
}

function EventDialog({ teamId, initial, onClose, onSaved }: { teamId: string; initial: EventRow | null; onClose: () => void; onSaved: () => void }) {
  const create = useServerFn(createTeamPost);
  const update = useServerFn(updateTeamPost);
  const [f, setF] = useState({
    kind: initial?.kind ?? ("tryout" as "tryout" | "clinic"),
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    date: toLocalInput(initial?.event_date ?? null),
    location: initial?.location ?? "",
    spots: initial?.spots_max?.toString() ?? "",
    price: initial?.price?.toString() ?? "",
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.title.trim() || !f.date) return toast.error("Title and date are required.");
    const spotsMax = f.spots ? Number(f.spots) : null;
    if (initial && spotsMax != null && spotsMax < (initial.spots_taken ?? 0))
      return toast.error(`${initial.spots_taken} people are already going — spots can't be lower.`);
    const payload = {
      kind: f.kind,
      title: f.title.trim(),
      body: f.body,
      eventDate: new Date(f.date).toISOString(),
      location: f.location || null,
      spotsMax,
      price: f.price ? Number(f.price) : null,
    };
    setBusy(true);
    try {
      const result = initial
        ? await update({ data: { id: initial.id, ...payload } })
        : await create({ data: { teamId, ...payload } });
      const held = heldNotice(result);
      if (held) toast.message(held);
      else toast.success(initial ? "Event updated" : "Event posted");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(blockedMessage(e) ?? "Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit event" : "New tryout or camp"}</DialogTitle>
          <DialogDescription>If your team has a published waiver, attendees sign it when they RSVP.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(["tryout", "clinic"] as const).map((k) => (
              <Button key={k} type="button" size="sm" variant={f.kind === k ? "default" : "outline"} onClick={() => setF({ ...f, kind: k })}>{KIND_LABEL[k]}</Button>
            ))}
          </div>
          <Input placeholder="Title (e.g. U14 fall tryouts)" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <Input type="datetime-local" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <Input placeholder="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
          <div className="flex gap-2">
            <Input type="number" min={1} placeholder="Spots (optional)" value={f.spots} onChange={(e) => setF({ ...f, spots: e.target.value })} />
            <Input type="number" min={0} placeholder="Fee $ (optional)" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </div>
          <Textarea placeholder="Details: age groups, what to bring…" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <Button className="w-full" disabled={busy} onClick={save}>{initial ? "Save changes" : "Post event"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
