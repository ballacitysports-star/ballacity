import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, X, Plus, MessageCircle, Send, Calendar, MapPin, Bell, Inbox, Loader2, SlidersHorizontal } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotificationCount } from "@/lib/notifications";
import { SPORTS } from "@/lib/sample-data";
import {
  type AvailabilityWithAuthor,
  createAvailability,
  createContactRequest,
  deleteAvailability,
  listOpenAvailabilities,
  type PlayerAvailability,
} from "@/lib/availability";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_tabs/players")({
  head: () => ({ meta: [{ title: "Players — OpenRun" }] }),
  component: PlayersPage,
});

const SKILLS = ["All Levels", "Beginner", "Intermediate", "Advanced"] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function PlayersPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [sport, setSport] = useState("");
  const [skill, setSkill] = useState<string>("");
  const [maxDistance, setMaxDistance] = useState<number>(0); // 0 = any
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [list, setList] = useState<AvailabilityWithAuthor[] | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [contactFor, setContactFor] = useState<AvailabilityWithAuthor | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setList(null);
    listOpenAvailabilities({ sport: sport || undefined })
      .then((rows) => { if (!cancelled) setList(rows); })
      .catch((e) => { if (!cancelled) { setList([]); toast.error(e.message || "Failed to load"); } });
    return () => { cancelled = true; };
  }, [sport, reloadTick]);

  const activeFilterCount = (skill ? 1 : 0) + (maxDistance > 0 ? 1 : 0);

  const filtered = useMemo(() => {
    if (!list) return null;
    const needle = q.trim().toLowerCase();
    return list.filter((a) => {
      if (skill && a.skill_level !== skill) return false;
      if (maxDistance > 0 && (a.travel_radius_km ?? 0) > maxDistance) return false;
      if (needle) {
        const hay = (a.author_name + " " + (a.city ?? "") + " " + (a.note ?? "") + " " + a.sports.join(" ")).toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [list, q, skill, maxDistance]);


  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="flex items-center justify-between mb-5">
        <Logo />
        <div className="flex items-center gap-2">
          <Link to="/messages" className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface" aria-label="Messages">
            <MessageCircle className="h-5 w-5" />
          </Link>
          <BellLink />
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <h1 className="font-display text-3xl font-bold leading-tight">Players ready to run.</h1>
        <p className="text-muted-foreground text-sm">
          Browse availability posts. Message or send a contact request.
        </p>
      </motion.div>

      <div className="flex gap-2 mb-4">
        <div className="flex-1 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, city, sport"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear search">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
        <button
          onClick={() => setFiltersOpen(true)}
          className={`relative grid h-11 w-11 place-items-center rounded-full border bg-surface ${activeFilterCount ? "border-lime" : "border-border"}`}
          aria-label="Filters"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-lime text-[10px] font-bold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          onClick={() => user ? setPostOpen(true) : toast.error("Sign in to post your availability.")}
          className="grid h-11 w-11 place-items-center rounded-full bg-lime-gradient text-primary-foreground glow-lime"
          aria-label="Post availability"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 mb-5">
        <div className="flex gap-2 pb-1">
          <Chip active={!sport} onClick={() => setSport("")}>All sports</Chip>
          {SPORTS.map((s) => (
            <Chip key={s.name} active={sport === s.name} onClick={() => setSport(s.name)}>
              <span className="mr-1">{s.emoji}</span>{s.name}
            </Chip>
          ))}
        </div>
      </div>


      <div className="-mx-4 overflow-x-auto px-4 mb-5">
        <div className="flex gap-2 pb-1">
          <Chip active={!sport} onClick={() => setSport("")}>All sports</Chip>
          {SPORTS.map((s) => (
            <Chip key={s.name} active={sport === s.name} onClick={() => setSport(s.name)}>
              <span className="mr-1">{s.emoji}</span>{s.name}
            </Chip>
          ))}
        </div>
      </div>

      {filtered === null ? (
        <LoadingRows />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={list && list.length > 0 ? "No matches" : "No one's posted yet"}
          body={list && list.length > 0 ? "Try a different search or sport." : "Be the first — share when you're free and where you'll travel."}
          cta={user ? (
            <Button onClick={() => setPostOpen(true)} className="rounded-full bg-lime-gradient text-primary-foreground">Post availability</Button>
          ) : (
            <Link to="/auth" className="inline-flex rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground">Sign in</Link>
          )}
        />
      ) : (
        <>
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {filtered.length} player{filtered.length === 1 ? "" : "s"} available
          </h2>
          <ul className="space-y-3 pb-6">
            {filtered.map((a) => (
              <AvailabilityCard
                key={a.id}
                a={a}
                isMine={user?.id === a.user_id}
                onContact={() => user ? setContactFor(a) : toast.error("Sign in to contact this player.")}
                onChanged={() => setReloadTick((t) => t + 1)}
              />
            ))}
          </ul>
        </>
      )}

      {postOpen && (
        <PostAvailabilityDialog
          onClose={() => setPostOpen(false)}
          onPosted={() => { setPostOpen(false); setReloadTick((t) => t + 1); toast.success("Availability posted"); }}
        />
      )}
      {contactFor && <ContactDialog availability={contactFor} onClose={() => setContactFor(null)} />}
    </div>
  );
}

function BellLink() {
  const unread = useUnreadNotificationCount();
  return (
    <Link to="/notifications" className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-surface" aria-label="Notifications">
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 grid h-4 min-w-4 px-1 place-items-center rounded-full bg-coral text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>
      )}
    </Link>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${active ? "border-lime bg-lime/15 text-foreground" : "border-border bg-surface text-muted-foreground"}`}
    >{children}</button>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-2xl border border-border bg-surface/40" />
      ))}
    </div>
  );
}

function EmptyState({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center">
      <Inbox className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground mt-1 mb-4">{body}</p>
      {cta}
    </div>
  );
}

function AvailabilityCard({ a, isMine, onContact, onChanged }: {
  a: AvailabilityWithAuthor; isMine: boolean; onContact: () => void; onChanged: () => void;
}) {
  const navigate = useNavigate();
  const initials = a.author_initials ?? a.author_name.slice(0, 2).toUpperCase();
  const when = formatWindow(a);

  const handleMessage = async () => {
    try {
      const id = await getOrCreateDirectConversation(a.user_id);
      navigate({ to: "/messages/$conversationId", params: { conversationId: id } });
    } catch (e: any) { toast.error(e.message || "Couldn't open chat"); }
  };

  const handleDelete = async () => {
    if (!confirm("Remove this availability post?")) return;
    try { await deleteAvailability(a.id); toast.success("Removed"); onChanged(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-lime-gradient font-bold text-primary-foreground">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold truncate">{a.author_name}</p>
            <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">{a.skill_level}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {a.sports.length === 0 ? (
              <span className="text-xs text-muted-foreground">Any sport</span>
            ) : a.sports.map((s) => {
              const emoji = SPORTS.find((sp) => sp.name === s)?.emoji ?? "🎯";
              return (
                <span key={s} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold">
                  {emoji} {s}
                </span>
              );
            })}
          </div>
          {when && (
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" /> {when}
            </p>
          )}
          {(a.city || a.travel_radius_km) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {a.city || "Anywhere"} · up to {a.travel_radius_km} km
            </p>
          )}
          {a.note && <p className="mt-2 text-sm leading-snug">{a.note}</p>}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {isMine ? (
          <Button variant="outline" size="sm" className="rounded-full" onClick={handleDelete}>
            <X className="h-4 w-4 mr-1" /> Remove
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={handleMessage} className="rounded-full flex-1 bg-lime-gradient text-primary-foreground">
              <MessageCircle className="h-4 w-4 mr-1" /> Message
            </Button>
            <Button size="sm" variant="outline" onClick={onContact} className="rounded-full flex-1">
              <Send className="h-4 w-4 mr-1" /> Contact
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function formatWindow(a: PlayerAvailability): string {
  const parts: string[] = [];
  if (a.starts_on || a.ends_on) {
    const s = a.starts_on ? fmtDate(a.starts_on) : "";
    const e = a.ends_on ? fmtDate(a.ends_on) : "";
    if (s && e) parts.push(s === e ? s : `${s} – ${e}`);
    else parts.push(s || e);
  }
  if (a.recurring_days.length) parts.push(a.recurring_days.join(" · "));
  return parts.join(" · ");
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function PostAvailabilityDialog({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [sports, setSports] = useState<string[]>([]);
  const [skill, setSkill] = useState<string>("All Levels");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(25);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const toggle = (arr: string[], v: string) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const save = async () => {
    if (sports.length === 0 && !note.trim()) {
      toast.error("Pick at least one sport or add a note.");
      return;
    }
    setSaving(true);
    try {
      await createAvailability({
        sports, skill_level: skill,
        starts_on: starts || null, ends_on: ends || null,
        recurring_days: days, city, travel_radius_km: radius, note,
      });
      onPosted();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Post availability</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Sports</Label>
            <div className="flex flex-wrap gap-2">
              {SPORTS.map((s) => (
                <Chip key={s.name} active={sports.includes(s.name)} onClick={() => setSports((arr) => toggle(arr, s.name))}>
                  <span className="mr-1">{s.emoji}</span>{s.name}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Skill level</Label>
            <div className="flex flex-wrap gap-2">
              {SKILLS.map((s) => (
                <Chip key={s} active={skill === s} onClick={() => setSkill(s)}>{s}</Chip>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="starts">From</Label>
              <Input id="starts" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ends">Until</Label>
              <Input id="ends" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Recurring days (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <Chip key={d} active={days.includes(d)} onClick={() => setDays((arr) => toggle(arr, d))}>{d}</Chip>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Austin" />
            </div>
            <div>
              <Label htmlFor="radius">Radius (km)</Label>
              <Input id="radius" type="number" min={1} max={500} value={radius} onChange={(e) => setRadius(Number(e.target.value) || 0)} />
            </div>
          </div>
          <div>
            <Label htmlFor="note">Short note</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3}
              placeholder="Positions, goals, what you're looking for…" />
            <p className="mt-1 text-[10px] text-muted-foreground text-right">{note.length}/500</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-lime-gradient text-primary-foreground">
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({ availability, onClose }: { availability: AvailabilityWithAuthor; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const send = async () => {
    setSaving(true);
    try {
      await createContactRequest(availability.id, availability.user_id, msg);
      toast.success("Contact request sent");
      onClose();
    } catch (e: any) {
      if (String(e.message).includes("duplicate")) toast.error("You've already sent a request.");
      else toast.error(e.message);
    } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Contact {availability.author_name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Send a short message introducing your team or session. {availability.author_name} can accept or decline.
        </p>
        <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} maxLength={500}
          placeholder="Hey! We're a Tuesday-night 7v7 squad short a midfielder…" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={saving} className="bg-lime-gradient text-primary-foreground">
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
