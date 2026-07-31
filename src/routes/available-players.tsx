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
  Ticket,
  Search,
  Share2,
  Heart,
  Bookmark,
  MoreHorizontal,
  SlidersHorizontal,
} from "lucide-react";
import { InfiniteList } from "@/components/InfiniteList";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";

import { FilterSheet, FilterSection, ChipRow } from "@/components/FilterSheet";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { SPORTS, type Game } from "@/lib/sample-data";
import { useHostedGames } from "@/lib/hosted-games-store";
import {
  type AvailabilityWithAuthor,
  type AvailabilityContactRequest,
  createAvailability,
  createContactRequest,
  deleteAvailability,
  getAvailabilityById,
  listMyAvailabilities,
  listMyContactRequests,
  listOpenAvailabilities,
  setContactRequestStatus,
  updateAvailability,
  type PlayerAvailability,
  type PlaceGeo,
} from "@/lib/availability";
import { haversineKm } from "@/lib/geo";

import { AvailabilitySchedulePicker } from "@/components/availability/AvailabilitySchedulePicker";
import { useMyBusyBlocks } from "@/lib/availability-conflicts";
import {
  formatAvailabilityWindow,
  parseTimeSlots,
  type TimeSlot,
} from "@/lib/availability-timeslots";
import { supabase } from "@/integrations/supabase/client";
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
import { kmToMi, miToKm, formatDistance } from "@/lib/distance";
import { Distance } from "@/components/Distance";
import { useDistanceUnit } from "@/lib/user-prefs-store";
import { RequestStatusPanel } from "@/components/RequestStatusPanel";
import { UserAvatar } from "@/components/UserAvatar";
import type { ExistingRequestSummary } from "@/lib/availability";

export const Route = createFileRoute("/available-players")({
  validateSearch: (s: Record<string, unknown>) => ({
    post: typeof s.post === "string" ? s.post : undefined,
  }),
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

type Tab = "browse" | "mine";

function AvailablePlayersPage() {
  const { user } = useAuth();
  const unit = useDistanceUnit();
  const navigate = useNavigate();
  const { post: postParam } = Route.useSearch();
  const [tab, setTab] = useState<Tab>("browse");
  const [sport, setSport] = useState<string>("");
  const [city, setCity] = useState("");
  // Google Places details for the typed city — powers accurate distance filtering.
  const [cityGeo, setCityGeo] = useState<PlaceGeo | null>(null);
  const changeCity = (v: string) => {
    setCity(v);
    setCityGeo(null);
  };

  const [includeAnywhere, setIncludeAnywhere] = useState(true);
  const [skill, setSkill] = useState<string>("All Levels");
  const [window, setWindow] = useState<"any" | "week" | "month" | "custom">("any");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [maxDistance, setMaxDistance] = useState<number>(0); // miles; 0 = any
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [list, setList] = useState<AvailabilityWithAuthor[] | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<PlayerAvailability | null>(null);
  const [contactFor, setContactFor] = useState<
    { availability: AvailabilityWithAuthor; mode: "contact" | "invite" } | null
  >(null);
  const [detailPost, setDetailPost] = useState<AvailabilityWithAuthor | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const allHosted = useHostedGames();
  const myHostedGames = useMemo(
    () =>
      user
        ? allHosted
            .filter((g) => g.hostUserId === user.id && new Date(g.date).getTime() >= Date.now())
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        : [],
    [allHosted, user?.id],
  );

  const { fromISO, toISO } = useMemo(() => {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const now = new Date();
    if (window === "week") {
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      return { fromISO: iso(now), toISO: iso(end) };
    }
    if (window === "month") {
      const end = new Date(now);
      end.setDate(end.getDate() + 30);
      return { fromISO: iso(now), toISO: iso(end) };
    }
    if (window === "custom") {
      return { fromISO: customFrom || undefined, toISO: customTo || undefined };
    }
    return { fromISO: undefined, toISO: undefined };
  }, [window, customFrom, customTo]);

  useEffect(() => {
    if (!postParam) {
      setDetailPost(null);
      return;
    }
    let cancelled = false;
    getAvailabilityById(postParam)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          toast.error("That availability post is no longer available.");
          navigate({ to: "/available-players", search: { post: undefined }, replace: true });
          return;
        }
        setDetailPost(row);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e.message || "Failed to load post");
      });
    return () => {
      cancelled = true;
    };
  }, [postParam, navigate]);


  useEffect(() => {
    setList(null);
  }, [sport, city, includeAnywhere, skill, fromISO, toISO]);

  const activeFilterCount =
    (skill !== "All Levels" ? 1 : 0) +
    (window !== "any" ? 1 : 0) +
    (city.trim() ? 1 : 0) +
    (maxDistance > 0 ? 1 : 0);

  const filteredList = useMemo(() => {
    if (!list) return null;
    if (maxDistance <= 0) return list;
    const km = miToKm(maxDistance);
    return list.filter((a) => {
      // Precise: both the filter city and the post carry Google Places coordinates.
      if (cityGeo && a.lat != null && a.lng != null) {
        return haversineKm(cityGeo, { lat: Number(a.lat), lng: Number(a.lng) }) <= km;
      }
      return (a.travel_radius_km ?? 0) <= km;
    });
  }, [list, maxDistance, cityGeo]);


  useEffect(() => {
    let cancelled = false;
    listOpenAvailabilities({
      sport: sport || undefined,
      city: city.trim() || undefined,
      includeAnywhere: city.trim() ? includeAnywhere : undefined,
      skill: skill !== "All Levels" ? skill : undefined,
      from: fromISO,
      to: toISO,
    })
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
  }, [sport, city, includeAnywhere, skill, fromISO, toISO, refreshKey]);

  // Realtime: refresh list whenever any availability row changes.
  useEffect(() => {
    const channel = supabase
      .channel("player-availabilities-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_availabilities" },
        () => setRefreshKey((k) => k + 1),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
            Post when you're free. Trainers & teams reach out.
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
          {/* Sport quick strip */}
          <div className="-mx-4 overflow-x-auto px-4 mb-2">
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

          {/* Active filters bar */}
          <div className="-mx-4 mb-3 overflow-x-auto px-4">
            <div className="flex items-center gap-2 pb-1">
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeFilterCount > 0
                    ? "border-lime bg-lime/15 text-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
                aria-label="Open filters"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="grid h-4 min-w-4 place-items-center rounded-full bg-lime px-1 text-[10px] font-bold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {activeFilterCount > 0 && (
                <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
              )}

              {skill !== "All Levels" && (
                <ActiveChip label={skill} onClear={() => setSkill("All Levels")} />
              )}
              {window !== "any" && (
                <ActiveChip
                  label={
                    window === "week"
                      ? "Next 7 days"
                      : window === "month"
                        ? "Next 30 days"
                        : `${customFrom || "…"} → ${customTo || "…"}`
                  }
                  onClear={() => {
                    setWindow("any");
                    setCustomFrom("");
                    setCustomTo("");
                  }}
                />
              )}
              {city.trim() && (
                <ActiveChip label={city.trim()} onClear={() => changeCity("")} />
              )}
              {maxDistance > 0 && (
                <ActiveChip
                  label={`≤ ${formatDistance(maxDistance, unit)}`}
                  onClear={() => setMaxDistance(0)}
                />
              )}

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSkill("All Levels");
                    setWindow("any");
                    setCustomFrom("");
                    setCustomTo("");
                    changeCity("");
                    setIncludeAnywhere(true);
                    setMaxDistance(0);
                  }}
                  className="ml-1 shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>





          {list === null ? (
            <LoadingRows />
          ) : (filteredList ?? []).length === 0 ? (
            <EmptyState
              title={activeFilterCount > 0 ? "No matches" : "No one's posted yet"}
              body={
                activeFilterCount > 0
                  ? "Try loosening a filter or clearing them all."
                  : "Be the first — share when you're free and where you'll travel."
              }
              cta={
                activeFilterCount > 0 ? (
                  <Button
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      setSport("");
                      setSkill("All Levels");
                      setWindow("any");
                      setCustomFrom("");
                      setCustomTo("");
                      changeCity("");
                      setIncludeAnywhere(true);
                      setMaxDistance(0);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : user ? (
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
            <InfiniteList
              items={filteredList ?? []}
              pageSize={6}
              keyFor={(a) => a.id}
              className="-mx-4 divide-y divide-border border-y border-border bg-background"
              renderSkeleton={() => <AvailabilityCardSkeleton />}
              renderItem={(a) => (
                <AvailabilityCard
                  a={a}
                  isMine={user?.id === a.user_id}
                  onContact={() =>
                    user
                      ? setContactFor({ availability: a, mode: "contact" })
                      : toast.error("Sign in to contact this player.")
                  }
                  onEdit={() => setEditingPost(a)}
                />
              )}
            />
          )}
        </>
      ) : (
        <MineTab user={user} onEdit={(m) => setEditingPost(m)} refreshKey={refreshKey} />
      )}

      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filter players"
        onReset={() => {
          setSport("");
          setSkill("All Levels");
          setWindow("any");
          setCustomFrom("");
          setCustomTo("");
          changeCity("");
          setIncludeAnywhere(true);
          setMaxDistance(0);
        }}
        resetDisabled={activeFilterCount === 0 && !sport}
      >
        <FilterSection label="Sport">
          <div className="flex flex-wrap gap-2">
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
        </FilterSection>

        <FilterSection label="Skill level">
          <ChipRow
            value={skill}
            onChange={(v) => setSkill(v)}
            options={SKILLS.map((s) => ({ value: s, label: s }))}
          />
        </FilterSection>

        <FilterSection label="Availability window">
          <ChipRow
            value={window}
            onChange={(v) => setWindow(v)}
            options={[
              { value: "any", label: "Any time" },
              { value: "week", label: "Next 7 days" },
              { value: "month", label: "Next 30 days" },
              { value: "custom", label: "Custom…" },
            ]}
          />
          {window === "custom" && (
            <div className="mt-2 flex gap-2">
              <div className="flex-1">
                <Label htmlFor="from-date" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  From
                </Label>
                <Input
                  id="from-date"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="to-date" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Until
                </Label>
                <Input
                  id="to-date"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>
          )}
        </FilterSection>

        <FilterSection label="Location">
          <LocationAutocomplete
            value={city}
            onChange={changeCity}
            placeholder="City (e.g. Austin)"
            mode="city"
            onPick={(full, placeId, geo) => {
              setCity(full);
              setCityGeo(
                geo
                  ? {
                      lat: geo.lat,
                      lng: geo.lng,
                      placeId,
                      formattedAddress: geo.formattedAddress ?? full,
                    }
                  : null,
              );
            }}
          />

          {city.trim() && (
            <label className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeAnywhere}
                onChange={(e) => setIncludeAnywhere(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Include players open to anywhere
            </label>
          )}
        </FilterSection>

        <FilterSection
          label="Max travel distance"
          hint={maxDistance > 0 ? formatDistance(maxDistance, unit) : "Any"}
        >
          {/* Slider steps in the viewer's unit; state stays in miles. */}
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(unit === "km" ? miToKm(maxDistance) : maxDistance)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setMaxDistance(unit === "km" ? Math.round(kmToMi(v) * 100) / 100 : v);
            }}
            className="w-full accent-lime"
            aria-label={`Max travel distance in ${unit === "km" ? "kilometers" : "miles"}`}
          />
          <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Any</span>
            <span>100 {unit}</span>
          </div>
        </FilterSection>
      </FilterSheet>


      {(postOpen || editingPost) && (
        <PostAvailabilityDialog
          initial={editingPost ?? undefined}
          onClose={() => {
            setPostOpen(false);
            setEditingPost(null);
          }}
          onPosted={() => {
            const wasEdit = !!editingPost;
            setPostOpen(false);
            setEditingPost(null);
            setRefreshKey((k) => k + 1);
            toast.success(wasEdit ? "Availability updated" : "Availability posted");
          }}
        />
      )}

      {contactFor && (
        <ContactDialog
          availability={contactFor.availability}
          mode={contactFor.mode}
          hostedGames={contactFor.mode === "invite" ? myHostedGames : []}
          onClose={() => setContactFor(null)}
        />
      )}

      {detailPost && (
        <AvailabilityDetailDialog
          a={detailPost}
          isMine={user?.id === detailPost.user_id}
          canInvite={myHostedGames.length > 0}
          onContact={(mode) => {
            if (!user) {
              toast.error("Sign in to contact this player.");
              return;
            }
            setContactFor({ availability: detailPost, mode });
            setDetailPost(null);
            navigate({ to: "/available-players", search: { post: undefined }, replace: true });
          }}
          onEdit={() => {
            setEditingPost(detailPost);
            setDetailPost(null);
            navigate({ to: "/available-players", search: { post: undefined }, replace: true });
          }}
          onClose={() => {
            setDetailPost(null);
            navigate({ to: "/available-players", search: { post: undefined }, replace: true });
          }}
        />
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

function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-lime bg-lime/15 px-2.5 py-1 text-[11px] font-semibold text-foreground">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label}`}
        className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
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
  onEdit,
}: {
  a: AvailabilityWithAuthor;
  isMine: boolean;
  onContact: () => void;
  onEdit: () => void;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const when = formatWindow(a);
  const primarySport = a.sports[0];
  const primaryEmoji = primarySport
    ? (SPORTS.find((s) => s.name === primarySport)?.emoji ?? "🎯")
    : "🎯";
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);

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
    <article className="bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2.5">
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
            size="md"
            rounded="full"
          />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <Link
            to="/players/$userId"
            params={{ userId: a.user_id }}
            className="block truncate text-sm font-semibold hover:underline"
          >
            {a.author_name}
          </Link>
          <span className="text-[11px] text-muted-foreground">
            {a.city || "Anywhere"} · up to <Distance km={a.travel_radius_km} />
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
          {a.skill_level}
        </span>
        <button
          type="button"
          aria-label="More options"
          className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </header>

      {/* Hero */}
      <div className="relative aspect-square w-full overflow-hidden bg-ig-gradient">
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-[9rem] leading-none drop-shadow-lg">{primaryEmoji}</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4">
          <div className="flex flex-wrap gap-1.5">
            {a.sports.length === 0 ? (
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                Any sport
              </span>
            ) : (
              a.sports.map((s) => {
                const emoji = SPORTS.find((sp) => sp.name === s)?.emoji ?? "🎯";
                return (
                  <span
                    key={s}
                    className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur"
                  >
                    {emoji} {s}
                  </span>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-1 px-3 pt-2">
        <button
          type="button"
          onClick={() => setLiked((v) => !v)}
          aria-label="Like"
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
        >
          <Heart className={`h-6 w-6 ${liked ? "fill-red-500 text-red-500" : ""}`} />
        </button>
        {!isMine && (
          <>
            <button
              type="button"
              onClick={handleMessage}
              aria-label="Message"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
            >
              <MessageCircle className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={onContact}
              aria-label="Contact request"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
            >
              <Send className="h-6 w-6" />
            </button>
          </>
        )}
        <div className="flex-1" />
        {isMine ? (
          <>
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
            >
              <Pencil className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Remove"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setSaved((v) => !v)}
            aria-label="Save"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
          >
            <Bookmark className={`h-6 w-6 ${saved ? "fill-foreground" : ""}`} />
          </button>
        )}
      </div>

      {/* Caption */}
      <div className="px-4 pb-4 pt-1 space-y-1">
        {when && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" /> {when}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          {a.city || "Anywhere"} · up to <Distance km={a.travel_radius_km} />
        </p>
        {a.note && (
          <p className="pt-1 text-sm leading-snug">
            <Link
              to="/players/$userId"
              params={{ userId: a.user_id }}
              className="font-semibold hover:underline"
            >
              {a.author_name}
            </Link>{" "}
            {a.note}
          </p>
        )}
      </div>
    </article>
  );
}

function AvailabilityCardSkeleton() {
  return (
    <article className="bg-background animate-pulse">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="h-10 w-10 rounded-full bg-secondary/60" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-32 rounded bg-secondary/60" />
          <div className="h-2.5 w-24 rounded bg-secondary/60" />
        </div>
        <div className="h-5 w-12 rounded-full bg-secondary/60" />
      </div>
      <div className="aspect-square w-full bg-secondary/40" />
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="h-6 w-6 rounded-full bg-secondary/60" />
        <div className="h-6 w-6 rounded-full bg-secondary/60" />
        <div className="h-6 w-6 rounded-full bg-secondary/60" />
      </div>
      <div className="space-y-1.5 px-4 pb-4">
        <div className="h-3 w-40 rounded bg-secondary/60" />
        <div className="h-3 w-2/3 rounded bg-secondary/60" />
      </div>
    </article>
  );
}

const formatWindow = (a: PlayerAvailability): string => formatAvailabilityWindow(a);

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function PostAvailabilityDialog({
  onClose,
  onPosted,
  initial,
}: {
  onClose: () => void;
  onPosted: () => void;
  initial?: PlayerAvailability;
}) {
  const isEdit = !!initial;
  const [sports, setSports] = useState<string[]>(initial?.sports ?? []);
  const [skill, setSkill] = useState<string>(initial?.skill_level ?? "All Levels");
  const [slots, setSlots] = useState<TimeSlot[]>(() => parseTimeSlots(initial?.time_slots ?? []));
  const { data: busy = [] } = useMyBusyBlocks({ excludeAvailabilityId: initial?.id });
  const [city, setCity] = useState(initial?.city ?? "");
  const [cityGeo, setCityGeo] = useState<PlaceGeo | null>(() =>
    initial?.lat != null && initial?.lng != null
      ? {
          lat: Number(initial.lat),
          lng: Number(initial.lng),
          placeId: initial.place_id ?? null,
          formattedAddress: initial.formatted_address ?? null,
        }
      : null,
  );
  const unit = useDistanceUnit();
  const [radius, setRadius] = useState(() =>
    initial ? Math.round(unit === "km" ? initial.travel_radius_km : kmToMi(initial.travel_radius_km)) : 25,
  );
  const [note, setNote] = useState(initial?.note ?? "");
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
      const payload = {
        sports,
        skill_level: skill,
        time_slots: slots,
        city,
        place_id: cityGeo?.placeId ?? null,
        formatted_address: cityGeo?.formattedAddress ?? null,
        lat: cityGeo?.lat ?? null,
        lng: cityGeo?.lng ?? null,
        travel_radius_km: unit === "km" ? radius : miToKm(radius),
        note,
      };
      if (isEdit && initial) {
        await updateAvailability(initial.id, payload);
      } else {
        await createAvailability(payload);
      }
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
          <DialogTitle>{isEdit ? "Edit availability" : "Post availability"}</DialogTitle>
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
          <div>
            <Label className="mb-2 block">When are you free?</Label>
            <AvailabilitySchedulePicker value={slots} onChange={setSlots} busy={busy} />
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <div>
              <Label htmlFor="city">City</Label>
              <LocationAutocomplete
                value={city}
                onChange={(v) => {
                  setCity(v);
                  setCityGeo(null);
                }}
                placeholder="e.g. Austin"
                mode="city"
                onPick={(full, placeId, geo) => {
                  setCity(full);
                  setCityGeo(
                    geo
                      ? {
                          lat: geo.lat,
                          lng: geo.lng,
                          placeId,
                          formattedAddress: geo.formattedAddress ?? full,
                        }
                      : null,
                  );
                }}
              />

            </div>
            <div>
              <Label htmlFor="radius">Radius ({unit})</Label>
              <Input
                id="radius"
                type="number"
                min={1}
                max={MAX_DISTANCE_MI}
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
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isEdit ? "Save changes" : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({
  availability,
  hostedGames = [],
  mode = "contact",
  onClose,
}: {
  availability: AvailabilityWithAuthor;
  hostedGames?: Game[];
  mode?: "contact" | "invite";
  onClose: () => void;
}) {
  const isInvite = mode === "invite" && hostedGames.length > 0;
  const [gameId, setGameId] = useState<string>(hostedGames[0]?.id ?? "");
  const selected = hostedGames.find((g) => g.id === gameId);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [existingStatus, setExistingStatus] = useState<
    "none" | "pending" | "accepted" | "declined" | "withdrawn"
  >("none");
  const isPending = existingStatus === "pending";

  const formattedDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const send = async () => {
    setSaving(true);
    try {
      let body = msg.trim();
      const invite =
        isInvite && selected
          ? {
              gameId: selected.id,
              title: selected.title,
              startsAt: selected.date,
              sport: selected.sport,
              location: selected.location,
            }
          : null;
      if (invite) {
        const header = `You're invited to ${selected!.title} — ${selected!.sport} on ${formattedDate(selected!.date)} at ${selected!.location}.`;
        body = body ? `${header}\n\n${body}` : header;
      }
      await createContactRequest(availability.id, availability.user_id, body, invite);
      toast.success(isInvite ? "Invite sent" : "Contact request sent");
      onClose();
    } catch (e: any) {
      const err = String(e?.message ?? "");
      if (err.includes("duplicate") || (e as { code?: string })?.code === "23505") {
        toast.error(
          isInvite
            ? "You already have a pending invite to this player for this game."
            : "You already have a pending request to this player.",
        );
        setRefreshKey((k) => k + 1);
      } else toast.error(err || "Couldn't send request");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isInvite
              ? `Invite ${availability.author_name}`
              : `Contact ${availability.author_name}`}
          </DialogTitle>
        </DialogHeader>
        <RequestStatusPanel
          availabilityId={availability.id}
          gameId={isInvite ? (selected?.id ?? null) : null}
          refreshKey={refreshKey}
          onLoaded={(s: ExistingRequestSummary) => setExistingStatus(s.status)}
          onCancelled={() => setExistingStatus("none")}
        />

        {isInvite && (
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {hostedGames.length > 1 ? "Pick an event" : "Event"}
            </Label>
            {hostedGames.length === 1 ? (
              <div className="rounded-2xl border border-border bg-surface p-3">
                <p className="font-semibold text-sm truncate">{hostedGames[0].title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {hostedGames[0].sport} · {formattedDate(hostedGames[0].date)}
                </p>
                <p className="text-xs text-muted-foreground truncate">{hostedGames[0].location}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {hostedGames.map((g) => {
                  const active = g.id === gameId;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGameId(g.id)}
                      className={`w-full text-left rounded-2xl border p-3 transition ${active ? "border-lime bg-lime/10" : "border-border bg-surface"}`}
                    >
                      <p className="font-semibold text-sm truncate">{g.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {g.sport} · {formattedDate(g.date)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{g.location}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {isInvite
            ? `Add a short note. ${availability.author_name} can accept or decline.`
            : `Send a short message introducing your team or session. ${availability.author_name} can accept or decline.`}
        </p>
        <Textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder={
            isInvite
              ? "We'd love to have you — let me know if you can make it!"
              : "Hey! We're a Tuesday-night 7v7 squad short a midfielder…"
          }
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={send}
            disabled={saving || isPending || (isInvite && !selected)}
            className="bg-lime-gradient text-primary-foreground"
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isPending
              ? isInvite
                ? "Invite pending"
                : "Request pending"
              : isInvite
                ? "Send invite"
                : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function MineTab({
  user,
  onEdit,
  refreshKey,
}: {
  user: { id: string } | null;
  onEdit: (m: PlayerAvailability) => void;
  refreshKey: number;
}) {
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
  }, [user?.id, refreshKey]);

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
                <div className="mt-2 flex gap-3">
                  <button
                    onClick={() => onEdit(m)}
                    className="text-xs font-semibold text-lime"
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm("Remove this post?")) return;
                      await deleteAvailability(m.id);
                      setMine((arr) => (arr ?? []).filter((x) => x.id !== m.id));
                    }}
                    className="text-xs font-semibold text-coral"
                  >
                    Remove
                  </button>
                </div>
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
                <p className="text-xs text-muted-foreground">From a trainer/team</p>
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

function AvailabilityDetailDialog({
  a,
  isMine,
  canInvite,
  onContact,
  onEdit,
  onClose,
}: {
  a: AvailabilityWithAuthor;
  isMine: boolean;
  canInvite: boolean;
  onContact: (mode: "contact" | "invite") => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const when = formatWindow(a);

  const handleMessage = async () => {
    try {
      const id = await getOrCreateDirectConversation(a.user_id);
      navigate({ to: "/messages/$conversationId", params: { conversationId: id } });
    } catch (e: any) {
      toast.error(e.message || "Couldn't open chat");
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/available-players?post=${encodeURIComponent(a.id)}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast.success("Link copied", { description: "Share it with anyone you want to reach this post." });
    } catch (e: any) {
      toast.error("Couldn't copy link", { description: e.message || "Please copy the URL manually." });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Updated availability</DialogTitle>
        </DialogHeader>
        <div className="rounded-2xl border border-lime/40 bg-lime/5 p-4">
          <div className="flex items-start gap-3">
            <UserAvatar
              avatarUrl={a.author_avatar_url}
              initials={a.author_initials}
              name={a.author_name}
              size="lg"
              rounded="square"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold truncate">{a.author_name}</p>
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
                  {a.city || "Anywhere"} · up to <Distance km={a.travel_radius_km} />
                </p>
              )}
          {a.note && <p className="mt-2 text-sm leading-snug">{a.note}</p>}
            </div>
          </div>
        </div>

        {!isMine && (
          <div className="mt-3">
            <RequestStatusPanel availabilityId={a.id} />
          </div>
        )}

        {isMine ? (
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={handleShare} className="rounded-full">
              <Share2 className="h-4 w-4 mr-1" /> Share
            </Button>
            <Button
              onClick={onEdit}
              className="rounded-full bg-lime-gradient text-primary-foreground"
            >
              <Pencil className="h-4 w-4 mr-1" /> Edit
            </Button>
          </DialogFooter>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={handleMessage} className="rounded-full">
              <MessageCircle className="h-4 w-4 mr-1" /> Message
            </Button>
            <Button
              variant="outline"
              onClick={() => onContact("contact")}
              className="rounded-full"
            >
              <Send className="h-4 w-4 mr-1" /> Contact
            </Button>
            {canInvite && (
              <Button
                onClick={() => onContact("invite")}
                className="rounded-full bg-lime-gradient text-primary-foreground"
              >
                <Ticket className="h-4 w-4 mr-1" /> Invite to game
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                onClose();
                navigate({ to: "/pickup" });
              }}
              className="rounded-full"
            >
              <Search className="h-4 w-4 mr-1" /> Find a game
            </Button>
            <Button
              variant="outline"
              onClick={handleShare}
              className="rounded-full col-span-2"
            >
              <Share2 className="h-4 w-4 mr-1" /> Share this availability
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
