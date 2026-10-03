import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, MapPin, Megaphone, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  listUpcomingTryouts,
  getTryoutRsvpContext,
  rsvpTryout,
  cancelTryoutRsvp,
  listMyManagedTeams,
  type TryoutListing,
} from "@/lib/tryouts.functions";
import { createTeamPost } from "@/lib/team-posts.functions";

const KIND_LABEL = { tryout: "Tryout", clinic: "Camp / Clinic" } as const;

function fmtDate(d: string | null) {
  if (!d) return "Date TBA";
  return new Date(d).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function TryoutsSection() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const list = useServerFn(listUpcomingTryouts);
  const { data = [], isLoading } = useQuery({ queryKey: ["tryouts", "upcoming"], queryFn: () => list() });
  const [active, setActive] = useState<TryoutListing | null>(null);
  const [posting, setPosting] = useState(false);

  const requireAuth = (fn: () => void) => (user ? fn() : navigate({ to: "/auth" }));

  return (
    <section id="tryouts" className="page-shell py-16" aria-labelledby="tryouts-heading">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="tryouts-heading" className="font-display text-3xl md:text-4xl font-bold">
            Open tryouts &amp; camps
          </h2>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Teams and coaches post tryouts and camps. Players and parents RSVP and sign the team waiver in one step.
          </p>
        </div>
        <Button onClick={() => requireAuth(() => setPosting(true))} className="rounded-full">
          <Megaphone className="mr-1 h-4 w-4" /> Post a tryout
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading events…</p>
      ) : data.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-semibold">No upcoming tryouts yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Run a team? Be the first to post one.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => {
            const left = t.spotsMax != null ? Math.max(t.spotsMax - t.spotsTaken, 0) : null;
            return (
              <li key={t.id} className="flex flex-col rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between text-xs">
                  <span className="rounded-full bg-lime/15 px-2 py-0.5 font-semibold text-lime">{KIND_LABEL[t.kind]}</span>
                  <span className="text-muted-foreground">{t.price ? `$${t.price}` : "Free"}</span>
                </div>
                <h3 className="mt-3 font-display text-lg font-semibold">{t.title}</h3>
                <Link to="/teams/$teamId" params={{ teamId: t.teamId }} className="text-sm text-muted-foreground hover:underline">
                  {t.teamName}
                </Link>
                <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />{fmtDate(t.eventDate)}</p>
                  {t.location && <p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{t.location}</p>}
                  {left != null && <p className="flex items-center gap-2"><Users className="h-4 w-4" />{left === 0 ? "Full" : `${left} spots left`}</p>}
                </div>
                <Button className="mt-4 rounded-full" variant="secondary" disabled={left === 0} onClick={() => requireAuth(() => setActive(t))}>
                  {left === 0 ? "Full" : "RSVP"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {active && <RsvpDialog tryout={active} onClose={() => setActive(null)} />}
      {posting && <PostTryoutDialog onClose={() => setPosting(false)} />}
    </section>
  );
}

function RsvpDialog({ tryout, onClose }: { tryout: TryoutListing; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ctxFn = useServerFn(getTryoutRsvpContext);
  const rsvp = useServerFn(rsvpTryout);
  const cancel = useServerFn(cancelTryoutRsvp);
  const ctxKey = ["tryouts", "ctx", tryout.id];
  const { data: ctx } = useQuery({ queryKey: ctxKey, queryFn: () => ctxFn({ data: { postId: tryout.id } }) });
  const [who, setWho] = useState<string>("me");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  const target = who === "me" ? user?.id : who;
  const onBehalf = who === "me" ? null : who;
  const isRegistered = !!target && ctx?.registered.includes(target);
  const needsWaiver = !!ctx?.waiver && !!target && !ctx.signed.includes(target);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ctxKey });
    qc.invalidateQueries({ queryKey: ["tryouts", "upcoming"] });
  };

  const submit = async () => {
    setBusy(true);
    const r = await rsvp({ data: { postId: tryout.id, onBehalfOf: onBehalf, waiverId: ctx?.waiver?.id ?? null, attested: agree } });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("You're registered!");
    refresh();
  };
  const doCancel = async () => {
    setBusy(true);
    const r = await cancel({ data: { postId: tryout.id, onBehalfOf: onBehalf } });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Registration cancelled");
    refresh();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tryout.title}</DialogTitle>
          <DialogDescription>{tryout.teamName} · {fmtDate(tryout.eventDate)}</DialogDescription>
        </DialogHeader>
        {tryout.body && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{tryout.body}</p>}
        {!ctx ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            {ctx.children.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Who's attending?</label>
                <select className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm" value={who} onChange={(e) => { setWho(e.target.value); setAgree(false); }}>
                  <option value="me">Me</option>
                  {ctx.children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {isRegistered ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-lime">Registered ✓</p>
                <Button variant="outline" disabled={busy} onClick={doCancel}>Cancel registration</Button>
              </div>
            ) : (
              <>
                {needsWaiver && ctx.waiver && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-sm font-semibold">{ctx.waiver.title} <span className="text-xs text-muted-foreground">v{ctx.waiver.version}</span></p>
                    <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">{ctx.waiver.content}</div>
                    <label className="mt-3 flex items-start gap-2 text-sm">
                      <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} />
                      <span>{onBehalf ? "I am this child's parent or legal guardian and agree to this waiver on their behalf." : "I have read and agree to this waiver."}</span>
                    </label>
                  </div>
                )}
                <Button className="w-full" disabled={busy || (needsWaiver && !agree)} onClick={submit}>
                  {needsWaiver ? "Sign waiver & RSVP" : "RSVP"}
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PostTryoutDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const teamsFn = useServerFn(listMyManagedTeams);
  const create = useServerFn(createTeamPost);
  const { data: teams } = useQuery({ queryKey: ["tryouts", "my-teams"], queryFn: () => teamsFn() });
  const [f, setF] = useState({ teamId: "", kind: "tryout" as "tryout" | "clinic", title: "", body: "", date: "", location: "", spots: "", price: "" });
  const [busy, setBusy] = useState(false);
  const teamId = f.teamId || teams?.[0]?.id || "";

  const submit = async () => {
    if (!teamId || !f.title.trim() || !f.date) return toast.error("Team, title and date are required.");
    setBusy(true);
    try {
      await create({
        data: {
          teamId, kind: f.kind, title: f.title.trim(), body: f.body,
          eventDate: new Date(f.date).toISOString(),
          location: f.location || null,
          spotsMax: f.spots ? Number(f.spots) : null,
          price: f.price ? Number(f.price) : null,
        },
      });
      toast.success("Posted! Players can now RSVP.");
      qc.invalidateQueries({ queryKey: ["tryouts", "upcoming"] });
      onClose();
    } catch {
      toast.error("Couldn't post. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post a tryout or camp</DialogTitle>
          <DialogDescription>If your team has a published waiver, attendees sign it when they RSVP.</DialogDescription>
        </DialogHeader>
        {!teams ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : teams.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p>You need to own, manage or coach a team to post tryouts.</p>
            <Button asChild><Link to="/teams/create">Create a team</Link></Button>
          </div>
        ) : (
          <div className="space-y-3">
            <select className="w-full rounded-md border border-input bg-background p-2 text-sm" value={teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
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
            <Button className="w-full" disabled={busy} onClick={submit}>Post</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
