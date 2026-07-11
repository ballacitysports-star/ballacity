import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  MapPin,
  MessageCircle,
  Send,
  Plus,
  Calendar,
  X,
  Loader2,
  Inbox,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { SPORTS } from "@/lib/sample-data";
import {
  type AvailabilityWithAuthor,
  type AvailabilityContactRequest,
  createAvailability,
  createContactRequest,
  deleteAvailability,
  listMyAvailabilities,
  listMyContactRequests,
  listOpenAvailabilities,
  setContactRequestStatus,
  updateAvailability,
  type PlayerAvailability,
} from "@/lib/availability";
import { getOrCreateDirectConversation } from "@/lib/messages";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { kmToMi, miToKm } from "@/lib/distance";
import { RequestStatusPanel } from "@/components/RequestStatusPanel";
import { UserAvatar } from "@/components/UserAvatar";
import type { ExistingRequestSummary } from "@/lib/availability";

export const Route = createFileRoute("/available-players")({
  head: () => ({
    meta: [
      { title: "Available Players — OpenRun" },
      {
        name: "description",
        content:
          "Browse players posting their availability and contact them to fill your roster, clinic, or pickup game.",
      },
      { property: "og:title", content: "Available Players — OpenRun" },
      { property: "og:description", content: "Find players ready to play and reach out directly." },
    ],
  }),
  component: AvailablePlayersPage,
});

const SKILLS = ["All Levels", "Beginner", "Intermediate", "Advanced"] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Tab = "browse" | "mine";

function AvailablePlayersPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("browse");
  const [sport, setSport] = useState<string>("");
  const [city, setCity] = useState("");
  const [list, setList] = useState<AvailabilityWithAuthor[] | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<PlayerAvailability | null>(null);
  const [contactFor, setContactFor] = useState<AvailabilityWithAuthor | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setList(null);
    listOpenAvailabilities({ sport: sport || undefined, city: city.trim() || undefined })
      .then((rows) => {
        if (!cancelled) setList(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setList([]);
          toast.error(e.message || "Failed to load");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sport, city]);

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-32">
      <div className="flex items-center gap-3 mb-5">
        <Link
          to="/teams"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold leading-tight">Available players</h1>
          <p className="text-xs text-muted-foreground">
            Post when you're free. Coaches & teams reach out.
          </p>
        </div>
        <button
          onClick={() =>
            user ? setPostOpen(true) : toast.error("Sign in to post your availability.")
          }
          className="grid h-10 w-10 place-items-center rounded-full bg-lime-gradient text-primary-foreground shadow"
          aria-label="Post availability"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <div className="mb-4 flex gap-2 rounded-full border border-border bg-surface p-1">
        <TabBtn active={tab === "browse"} onClick={() => setTab("browse")}>
          Browse
        </TabBtn>
        <TabBtn active={tab === "mine"} onClick={() => setTab("mine")}>
          My posts & requests
        </TabBtn>
      </div>

      {tab === "browse" ? (
        <>
          <div className="mb-3 space-y-2">
            <div className="-mx-4 overflow-x-auto px-4">
              <div className="flex gap-2 pb-1">
                <Chip active={!sport} onClick={() => setSport("")}>
                  All sports
                </Chip>
                {SPORTS.map((s) => (
                  <Chip key={s.name} active={sport === s.name} onClick={() => setSport(s.name)}>
                    <span className="mr-1">{s.emoji}</span>
                    {s.name}
                  </Chip>
                ))}
              </div>
            </div>
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Filter by city"
              className="h-10"
            />
          </div>

          {list === null ? (
            <LoadingRows />
          ) : list.length === 0 ? (
            <EmptyState
              title="No one's posted yet"
              body="Be the first — share when you're free and where you'll travel."
              cta={
                user ? (
                  <Button onClick={() => setPostOpen(true)} className="rounded-full">
                    Post availability
                  </Button>
                ) : (
                  <Link
                    to="/auth"
                    className="inline-flex rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground"
                  >
                    Sign in
                  </Link>
                )
              }
            />
          ) : (
            <ul className="space-y-3">
              {list.map((a) => (
                <AvailabilityCard
                  key={a.id}
                  a={a}
                  isMine={user?.id === a.user_id}
                  onContact={() =>
                    user ? setContactFor(a) : toast.error("Sign in to contact this player.")
                  }
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        <MineTab user={user} />
      )}

      {postOpen && (
        <PostAvailabilityDialog
          onClose={() => setPostOpen(false)}
          onPosted={() => {
            setPostOpen(false);
            // refetch list
            listOpenAvailabilities({
              sport: sport || undefined,
              city: city.trim() || undefined,
            }).then(setList);
            toast.success("Availability posted");
          }}
        />
      )}

      {contactFor && (
        <ContactDialog availability={contactFor} onClose={() => setContactFor(null)} />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-lime-gradient text-primary-foreground" : "text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${active ? "border-lime bg-lime/15 text-foreground" : "border-border bg-surface text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-2xl border border-border bg-surface/40"
        />
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

function AvailabilityCard({
  a,
  isMine,
  onContact,
}: {
  a: AvailabilityWithAuthor;
  isMine: boolean;
  onContact: () => void;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const when = formatWindow(a);

  const handleMessage = async () => {
    try {
      const id = await getOrCreateDirectConversation(a.user_id);
      navigate({ to: "/messages/$conversationId", params: { conversationId: id } });
    } catch (e: any) {
      toast.error(e.message || "Couldn't open chat");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Remove this availability post?")) return;
    try {
      await deleteAvailability(a.id);
      toast.success("Removed");
      router.invalidate();
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <Link
          to="/players/$userId"
          params={{ userId: a.user_id }}
          aria-label={`View ${a.author_name}'s profile`}
          className="shrink-0"
        >
          <UserAvatar
            avatarUrl={a.author_avatar_url}
            initials={a.author_initials}
            name={a.author_name}
            size="lg"
            rounded="square"
          />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/players/$userId"
              params={{ userId: a.user_id }}
              className="font-semibold truncate hover:underline"
            >
              {a.author_name}
            </Link>
            <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
              {a.skill_level}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {a.sports.length === 0 ? (
              <span className="text-xs text-muted-foreground">Any sport</span>
            ) : (
              a.sports.map((s) => {
                const emoji = SPORTS.find((sp) => sp.name === s)?.emoji ?? "🎯";
                return (
                  <span
                    key={s}
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold"
                  >
                    {emoji} {s}
                  </span>
                );
              })
            )}
          </div>
          {when && (
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" /> {when}
            </p>
          )}
          {(a.city || a.travel_radius_km) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {a.city || "Anywhere"} · up to {kmToMi(a.travel_radius_km)} mi
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
            <Button
              size="sm"
              onClick={handleMessage}
              className="rounded-full flex-1 bg-lime-gradient text-primary-foreground"
            >
              <MessageCircle className="h-4 w-4 mr-1" /> Message
            </Button>
            <Button size="sm" variant="outline" onClick={onContact} className="rounded-full flex-1">
              <Send className="h-4 w-4 mr-1" /> Contact request
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

function PostAvailabilityDialog({
  onClose,
  onPosted,
}: {
  onClose: () => void;
  onPosted: () => void;
}) {
  const [sports, setSports] = useState<string[]>([]);
  const [skill, setSkill] = useState<string>("All Levels");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(25);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const save = async () => {
    if (sports.length === 0 && !note.trim()) {
      toast.error("Pick at least one sport or add a note.");
      return;
    }
    setSaving(true);
    try {
      await createAvailability({
        sports,
        skill_level: skill,
        starts_on: starts || null,
        ends_on: ends || null,
        recurring_days: days,
        city,
        travel_radius_km: miToKm(radius),
        note,
      });
      onPosted();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post availability</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Sports</Label>
            <div className="flex flex-wrap gap-2">
              {SPORTS.map((s) => (
                <Chip
                  key={s.name}
                  active={sports.includes(s.name)}
                  onClick={() => setSports((arr) => toggle(arr, s.name))}
                >
                  <span className="mr-1">{s.emoji}</span>
                  {s.name}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Skill level</Label>
            <div className="flex flex-wrap gap-2">
              {SKILLS.map((s) => (
                <Chip key={s} active={skill === s} onClick={() => setSkill(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="starts">From</Label>
              <Input
                id="starts"
                type="date"
                value={starts}
                onChange={(e) => setStarts(e.target.value)}
              />
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
                <Chip
                  key={d}
                  active={days.includes(d)}
                  onClick={() => setDays((arr) => toggle(arr, d))}
                >
                  {d}
                </Chip>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <div>
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Austin"
              />
            </div>
            <div>
              <Label htmlFor="radius">Radius (mi)</Label>
              <Input
                id="radius"
                type="number"
                min={1}
                max={500}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="note">Short note</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Positions, goals, what you're looking for…"
            />
            <p className="mt-1 text-[10px] text-muted-foreground text-right">{note.length}/500</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-lime-gradient text-primary-foreground"
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({
  availability,
  onClose,
}: {
  availability: AvailabilityWithAuthor;
  onClose: () => void;
}) {
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [existingStatus, setExistingStatus] = useState<
    "none" | "pending" | "accepted" | "declined" | "withdrawn"
  >("none");
  const isPending = existingStatus === "pending";

  const send = async () => {
    setSaving(true);
    try {
      await createContactRequest(availability.id, availability.user_id, msg);
      toast.success("Contact request sent");
      onClose();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("duplicate") || (e as { code?: string })?.code === "23505") {
        toast.error("You already have a pending request to this player.");
        setRefreshKey((k) => k + 1);
      } else toast.error(msg || "Couldn't send request");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Contact {availability.author_name}</DialogTitle>
        </DialogHeader>
        <RequestStatusPanel
          availabilityId={availability.id}
          gameId={null}
          refreshKey={refreshKey}
          onLoaded={(s: ExistingRequestSummary) => setExistingStatus(s.status)}
          onCancelled={() => setExistingStatus("none")}
        />
        <p className="text-sm text-muted-foreground">
          Send a short message introducing your team or session. {availability.author_name} can
          accept or decline.
        </p>
        <Textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder="Hey! We're a Tuesday-night 7v7 squad short a midfielder…"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={send}
            disabled={saving || isPending}
            className="bg-lime-gradient text-primary-foreground"
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isPending ? "Request pending" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MineTab({ user }: { user: { id: string } | null }) {
  const [mine, setMine] = useState<PlayerAvailability[] | null>(null);
  const [inbox, setInbox] = useState<AvailabilityContactRequest[] | null>(null);
  const [outbox, setOutbox] = useState<AvailabilityContactRequest[] | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      listMyAvailabilities().then(setMine),
      listMyContactRequests("inbox").then(setInbox),
      listMyContactRequests("outbox").then(setOutbox),
    ]).catch((e) => toast.error(e.message));
  }, [user?.id]);

  if (!user) {
    return (
      <EmptyState
        title="Sign in"
        body="Sign in to manage your availability posts and contact requests."
        cta={
          <Link
            to="/auth"
            className="inline-flex rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground"
          >
            Sign in
          </Link>
        }
      />
    );
  }

  const act = async (id: string, status: "accepted" | "declined") => {
    try {
      await setContactRequestStatus(id, status);
      setInbox((arr) => (arr ?? []).map((r) => (r.id === id ? { ...r, status } : r)));
      toast.success(status === "accepted" ? "Accepted" : "Declined");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Your posts
        </h2>
        {mine === null ? (
          <LoadingRows />
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts yet.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((m) => (
              <li key={m.id} className="rounded-2xl border border-border bg-surface p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{m.sports.join(", ") || "Any sport"}</span>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">
                    {m.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatWindow(m) || "No date set"} · {m.city || "Anywhere"}
                </p>
                <button
                  onClick={async () => {
                    if (!confirm("Remove this post?")) return;
                    await deleteAvailability(m.id);
                    setMine((arr) => (arr ?? []).filter((x) => x.id !== m.id));
                  }}
                  className="mt-2 text-xs font-semibold text-coral"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Requests to you
        </h2>
        {inbox === null ? (
          <LoadingRows />
        ) : inbox.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <ul className="space-y-2">
            {inbox.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-surface p-3 text-sm">
                <p className="text-xs text-muted-foreground">From a coach/team</p>
                {r.message && <p className="mt-1">{r.message}</p>}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">
                    {r.status}
                  </span>
                  {r.status === "pending" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full h-7"
                        onClick={() => act(r.id, "declined")}
                      >
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        className="rounded-full h-7 bg-lime-gradient text-primary-foreground"
                        onClick={() => act(r.id, "accepted")}
                      >
                        Accept
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Requests you sent
        </h2>
        {outbox === null ? (
          <LoadingRows />
        ) : outbox.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outgoing requests.</p>
        ) : (
          <ul className="space-y-2">
            {outbox.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-surface p-3 text-sm">
                {r.message && <p>{r.message}</p>}
                <span className="text-[10px] uppercase font-bold text-muted-foreground">
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
