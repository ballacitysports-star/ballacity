import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Users,
  DollarSign,
  Lock,
  Home,
  ShieldCheck,
  ImagePlus,
  Clock3,
} from "lucide-react";
import { SPORTS, type Sport, imageFor } from "@/lib/sample-data";
import { addHostedGame } from "@/lib/hosted-games-store";
import { SIGNUP_CUTOFF_PRESETS } from "@/lib/live-status";
import {
  ANY_SKILL,
  filterTiersForSport,
  parseSkillTiers,
  scaleForSport,
  serializeSkillTiers,
  toggleSkillTier,
} from "@/lib/sport-levels";
import { useServerFn } from "@tanstack/react-start";
import { reverseGeocode } from "@/lib/geocode.functions";
import { listMyTeams } from "@/lib/teams.functions";
import { listMyOrgs } from "@/lib/trainer-orgs.functions";
import { useQuery } from "@tanstack/react-query";
import { useMyProfiles } from "@/lib/account-profiles";

import { toast } from "sonner";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { useMyProfile } from "@/lib/user-prefs-store";
import { useAuth } from "@/hooks/use-auth";
import { upsertGamePaymentSettings } from "@/lib/payments";
import { ImageUploader } from "@/components/ImageUploader";
import { PositionsPicker, positionsCleanup, type PositionsNeeded } from "@/components/PositionsPicker";




export const Route = createFileRoute("/_tabs/create")({
  head: () => ({ meta: [{ title: "Host a game — OpenRun" }] }),
  component: Create,
});

function Create() {
  const nav = useNavigate();
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const fetchMyTeams = useServerFn(listMyTeams);
  const myTeamsQuery = useQuery({
    queryKey: ["my-teams", user?.id ?? "anon"],
    queryFn: () => fetchMyTeams(),
    enabled: !!user,
    staleTime: 30_000,
  });
  const myTeams = myTeamsQuery.data ?? [];
  type Affiliation = {
    source: "team";
    id: string;
    name: string;
    kind?: "team" | "coach";
  };
  // Games are always published under a team profile the account owns.
  const affiliations: Affiliation[] = myTeams
    .filter((t) => t.kind !== "coach")
    .map((t) => ({ source: "team" as const, id: t.id, name: t.name, kind: t.kind }));
  const affiliationsLoading = myTeamsQuery.isLoading;
  const { active: activeProfile } = useMyProfiles();
  const activeRefId = activeProfile && activeProfile.kind === "team" ? activeProfile.refId : null;
  const [selectedAffiliation, setSelectedAffiliation] = useState<Affiliation | null>(null);
  const hostAsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (affiliationsLoading) return;
    if (affiliations.length === 0) {
      setSelectedAffiliation(null);
      return;
    }
    // Prefer the team the app is currently acting as, then fall back to the
    // only team the account owns.
    const preferred =
      (activeRefId ? affiliations.find((a) => a.id === activeRefId) : undefined) ??
      (affiliations.length === 1 ? affiliations[0] : undefined);
    if (preferred) setSelectedAffiliation((cur) => cur ?? preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affiliations.length, affiliationsLoading, activeRefId]);
  const affiliationLabel = (_a: Affiliation) => "Team";
  const affiliationShortLabel = affiliationLabel;


  const [sport, setSport] = useState<Sport>("Basketball");

  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState(profile?.city ?? "");
  const previousProfileCityRef = useRef(profile?.city ?? "");
  const locationEditedRef = useRef(false);
  // Skill options follow the picked sport's real scale (Flag / 7v7 /
  // Full contact for Football) so a game reads like a profile tier.
  const [skill, setSkill] = useState<string>(ANY_SKILL);
  const skillOptions = [ANY_SKILL, ...filterTiersForSport(sport)];
  const selectedSkillTiers = parseSkillTiers(sport, skill);
  const skillMulti = scaleForSport(sport).multi ?? false;
  useEffect(() => {
    if (skill === ANY_SKILL) return;
    const kept = serializeSkillTiers(sport, parseSkillTiers(sport, skill));
    if (kept !== skill) setSkill(kept);
  }, [sport, skill]);
  const [size, setSize] = useState(10);
  const [price, setPrice] = useState(0);
  const [indoor, setIndoor] = useState(false);
  const [priv, setPriv] = useState(false);
  const [description, setDescription] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [signupCutoffMin, setSignupCutoffMin] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [positionsNeeded, setPositionsNeeded] = useState<PositionsNeeded>({});
  const [repeatRange, setRepeatRange] = useState(false);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  const rangeDates: string[] = (() => {
    if (!repeatRange || !rangeStart || !rangeEnd) return [];
    const start = new Date(rangeStart + "T00:00:00");
    const end = new Date(rangeEnd + "T00:00:00");
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
    const out: string[] = [];
    for (let d = new Date(start); d <= end && out.length < 60; d.setDate(d.getDate() + 1)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      out.push(`${y}-${m}-${day}`);
    }
    return out;
  })();



  useEffect(() => {
    const nextCity = profile?.city?.trim() ?? "";
    const previousCity = previousProfileCityRef.current;
    if (nextCity === previousCity) return;
    previousProfileCityRef.current = nextCity;

    if (!nextCity) return;
    // Don't clobber an address the user already typed or that GPS auto-filled.
    if (locationEditedRef.current) return;
    if (location.trim()) return;
    setLocation(nextCity);
    // location intentionally read at effect-time only; we don't want the
    // effect to re-fire whenever location changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.city]);

  // Auto-fill the venue address from the device's current GPS location when
  // the user hasn't typed anything yet. Runs once on mount; manual edits or
  // a profile-city value present at mount take precedence.
  const reverse = useServerFn(reverseGeocode);
  useEffect(() => {
    if (locationEditedRef.current) return;
    if (location.trim()) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled || locationEditedRef.current) return;
        try {
          const res = await reverse({
            data: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          const next = res?.formatted || res?.city;
          if (next && !cancelled && !locationEditedRef.current) {
            // Mark as edited so a late-loading profile.city doesn't overwrite.
            locationEditedRef.current = true;
            setLocation(next);
          }
        } catch {
          /* silent — user can still type manually */
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );

    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLocationChange = (next: string) => {
    locationEditedRef.current = true;
    setLocation(next);
  };

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 pt-6">
        <div className="flex items-center gap-3 mb-5">
          <Link
            to="/feed"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-display text-2xl font-bold">Host a game</h1>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 text-center space-y-4">
          <ShieldCheck className="h-8 w-8 mx-auto text-lime" />
          <div>
            <h2 className="font-display text-lg font-bold">Sign in to host</h2>
            <p className="text-sm text-muted-foreground mt-1">
              You need an account so we can lock in host controls and let players contact you.
            </p>
          </div>
          <Link
            to="/auth"
            search={{ redirect: "/create" } as any}
            className="inline-block w-full rounded-2xl bg-lime-gradient py-3 font-bold text-primary-foreground glow-lime"
          >
            Sign in to host a game
          </Link>
        </div>
      </div>
    );
  }

  // Gate: games are always published under a team or gym profile.
  if (affiliationsLoading) {
    return (
      <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 pt-6">
        <div className="h-8 w-40 bg-surface rounded-lg animate-pulse mb-4" />
        <div className="h-32 bg-surface rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (affiliations.length === 0) {
    return (
      <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 pt-6">
        <div className="flex items-center gap-3 mb-5">
          <Link to="/feed" className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-display text-2xl font-bold">Host a game</h1>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 text-center space-y-4">
          <ShieldCheck className="h-8 w-8 mx-auto text-lime" />
          <div>
            <h2 className="font-display text-lg font-bold">Host as a team or gym</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Games are published under a team or gym profile so players know who they're joining.
              Add a team or gym profile to your account to start hosting — your player and trainer
              profiles stay as they are.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Link
              to="/teams/create"
              className="rounded-2xl bg-lime-gradient py-3 font-bold text-primary-foreground glow-lime"
            >
              Create a team
            </Link>
            <Link
              to="/orgs/create"
              className="rounded-2xl border border-border bg-background py-3 font-bold"
            >
              Create a club / gym
            </Link>
          </div>
        </div>
      </div>
    );
  }




  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 pt-6">
      <div className="flex items-center gap-3 mb-5">
        <Link
          to="/feed"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Host a game</h1>
      </div>


      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (publishing) return;
          if (!user) {
            toast.error("Sign in to host a game");
            nav({ to: "/auth", search: { redirect: "/create" } as any });
            return;
          }
          if (!selectedAffiliation) {
            toast.error("Pick which team or gym profile you're hosting as");
            hostAsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            hostAsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
            return;
          }
          setPublishing(true);

          try {
            // Compute one or many ISO datetimes.
            let dates: string[];
            if (repeatRange) {
              if (rangeDates.length === 0) {
                toast.error("Pick a valid start and end date.");
                setPublishing(false);
                return;
              }
              const time = when.includes("T") ? when.split("T")[1] : when;
              const t = time && /^\d{2}:\d{2}/.test(time) ? time : "18:00";
              dates = rangeDates.map((d) => new Date(`${d}T${t}`).toISOString());
            } else {
              dates = [
                when
                  ? new Date(when).toISOString()
                  : new Date(Date.now() + 3600_000).toISOString(),
              ];
            }

            // Build the host snapshot from the freshest profile available so
            // it never falls back to an email-prefix default when the
            // in-memory profile hasn't loaded yet. See host-snapshot.test.ts.
            const { supabase } = await import("@/integrations/supabase/client");
            const { resolveHostSnapshot } = await import("@/lib/host-snapshot");
            const hostSnap = await resolveHostSnapshot({
              userId: user.id,
              userEmail: user.email,
              fallback: profile
                ? {
                    name: profile.name,
                    username: profile.username,
                    avatar: profile.avatar,
                    rating: profile.stats.sportsmanship,
                  }
                : null,
              fetchDbProfile: async (id) => {
                const { data } = await supabase
                  .from("profiles")
                  .select("display_name, username, avatar_initials, avatar_url")
                  .eq("id", id)
                  .maybeSingle();
                return data as any;
              },
            });

            const cleanPositions = positionsCleanup(positionsNeeded);
            let firstGameId: string | null = null;
            for (const date of dates) {
              const game = await addHostedGame({
                sport,
                title,
                date,
                location,
                skill,
                maxPlayers: size,
                price,
                indoor,
                isPrivate: priv,
                description,
                hostUserId: user?.id,
                host: hostSnap,
                image: coverUrl ?? undefined,
                positionsNeeded: cleanPositions,
                signupCutoffMin,
                teamId: selectedAffiliation?.source === "team" ? selectedAffiliation.id : undefined,
                orgId: selectedAffiliation?.source === "org" ? selectedAffiliation.id : undefined,
              });

              if (!firstGameId) firstGameId = game.id;

              // Persist host ownership + approval/fee preferences so the host & players see them on the detail page
              try {
                await upsertGamePaymentSettings({
                  game_id: game.id,
                  entry_fee: price,
                  accepted_method_ids: [],
                  requires_approval: requiresApproval,
                });
              } catch (err: any) {
                toast.error(err?.message ?? "Saved game, but couldn't lock host ownership.");
              }
            }

            // Note: do NOT auto-join the host. Hosting ≠ playing; the host
            // sees their published games in the profile's hosted section.
            if (dates.length > 1) {
              toast.success(`Created ${dates.length} games`);
              nav({ to: "/feed" });
            } else {
              toast.success("Game published");
              nav({ to: "/games/$gameId", params: { gameId: firstGameId! } });
            }
          } finally {
            setPublishing(false);
          }
        }}
        className="space-y-5"
      >
        {/* Host as (team/club) */}
        <div
          ref={hostAsRef}
          className={`rounded-2xl ${
            !selectedAffiliation && affiliations.length > 1
              ? "border border-destructive/60 bg-destructive/5 p-3"
              : ""
          }`}
        >
          <Section
            title="Host as"
            right={
              !selectedAffiliation && affiliations.length > 1 ? (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                  Required
                </span>
              ) : undefined
            }
          >
          {affiliations.length === 1 ? (
            <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-lime/10 text-lime text-sm font-bold shrink-0">
                  {(affiliations[0].name || "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{affiliations[0].name}</div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {affiliationLabel(affiliations[0])}
                  </div>
                </div>
              </div>
              <span className="text-[11px] text-muted-foreground">Auto-selected</span>
            </div>
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
                {affiliations.map((a) => {
                  const active =
                    selectedAffiliation?.source === a.source && selectedAffiliation.id === a.id;
                  return (
                    <button
                      type="button"
                      key={`${a.source}:${a.id}`}
                      onClick={() => setSelectedAffiliation(a)}
                      className={`shrink-0 flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
                        active
                          ? "border-lime bg-lime/10 text-lime"
                          : "border-border bg-surface text-muted-foreground"
                      }`}
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-background text-xs font-bold">
                        {(a.name || "?").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="truncate max-w-[10rem]">{a.name}</span>
                      <span className="text-[10px] uppercase tracking-wider opacity-70">
                        {affiliationShortLabel(a)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!selectedAffiliation && (
                <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                  Pick the team or gym profile you're hosting as to continue.
                </p>
              )}
            </>
          )}
          </Section>
        </div>

        <fieldset
          disabled={!selectedAffiliation}
          className={`space-y-5 border-0 p-0 m-0 min-w-0 ${
            !selectedAffiliation ? "opacity-50 pointer-events-none" : ""
          }`}
        >


        <Section title="Sport">

          <div className="grid grid-cols-3 gap-2">
            {SPORTS.map((s) => {
              const active = sport === s.name;
              return (
                <button
                  type="button"
                  key={s.name}
                  onClick={() => { setSport(s.name); setPositionsNeeded({}); }}
                  className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-semibold transition-all ${
                    active
                      ? "border-lime bg-lime/10 text-lime"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  <span className="text-2xl">{s.emoji}</span>
                  <span>{s.name}</span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Cover photo */}
        <Section title="Cover photo" icon={<ImagePlus className="h-4 w-4" />}>
          <ImageUploader
            kind="cover"
            bucket="game-covers"
            pathPrefix={user?.id}
            value={coverUrl ?? ""}
            fallback={imageFor(sport)}
            onChange={setCoverUrl}
            onClear={() => setCoverUrl(null)}
            presets={[sport]}
            allowBgRemoval={false}
          />
        </Section>



        {/* Title */}
        <Section title="Game title">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Friday Night Run · 5v5 Full Court"
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
          />
        </Section>

        {/* Date */}
        <Section title={repeatRange ? "Time" : "When"} icon={<Calendar className="h-4 w-4" />}>
          {repeatRange ? (
            <input
              type="time"
              value={when.includes("T") ? when.split("T")[1] : when}
              onChange={(e) => setWhen(e.target.value)}
              className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime [color-scheme:dark]"
            />
          ) : (
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime [color-scheme:dark]"
            />
          )}
          <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Repeat on multiple days</span>
              <button
                type="button"
                onClick={() => setRepeatRange((v) => !v)}
                className={`relative h-6 w-10 rounded-full transition-colors ${repeatRange ? "bg-lime" : "bg-secondary"}`}
                aria-label="Toggle date range"
              >
                <motion.span
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow"
                  style={{ left: repeatRange ? "calc(100% - 1.375rem)" : "0.125rem" }}
                />
              </button>
            </div>
            {repeatRange && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted-foreground">
                    Start date
                    <input
                      type="date"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime [color-scheme:dark]"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    End date
                    <input
                      type="date"
                      value={rangeEnd}
                      min={rangeStart || undefined}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime [color-scheme:dark]"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {rangeDates.length > 0
                    ? `Will create ${rangeDates.length} game${rangeDates.length === 1 ? "" : "s"}, one per day at the time above.`
                    : "Pick start and end dates (max 60 days)."}
                </p>
              </div>
            )}
          </div>
        </Section>

        {/* Venue address */}
        <Section title="Venue address" icon={<MapPin className="h-4 w-4" />}>
          <LocationAutocomplete
            value={location}
            onChange={handleLocationChange}
            placeholder="Search court, park or venue"
          />
          {profile?.city && (
            <p className="px-1 text-[11px] text-muted-foreground">
              Pre-filled from your profile city — refine with search above.
            </p>
          )}
        </Section>

        {/* Skill */}
        <Section title={`Skill level · ${scaleForSport(sport).system}`}>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {skillOptions.map((s) => {
              const active =
                s === ANY_SKILL
                  ? selectedSkillTiers.length === 0
                  : selectedSkillTiers.includes(s);
              return (
                <button
                  type="button"
                  key={s}
                  aria-pressed={active}
                  onClick={() =>
                    setSkill(s === ANY_SKILL ? ANY_SKILL : toggleSkillTier(sport, skill, s))
                  }
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${
                    active
                      ? "border-lime bg-lime text-primary-foreground"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
          {skillMulti && (
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              Pick a level in each format you welcome — selections combine (e.g. "Flag Rec ·
              7v7 Elite").
            </p>
          )}
        </Section>

        {/* Positions needed */}
        <Section title="Positions needed">
          <PositionsPicker
            sport={sport}
            value={positionsNeeded}
            onChange={setPositionsNeeded}
          />
        </Section>

        {/* Players */}
        <Section title="Max players" icon={<Users className="h-4 w-4" />}>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Total spots</span>
              <span className="font-display text-2xl font-bold text-lime">{size}</span>
            </div>
            <input
              type="range"
              min={2}
              max={30}
              value={size}
              onChange={(e) => setSize(+e.target.value)}
              className="w-full accent-lime"
            />
          </div>
        </Section>

        {/* Toggles */}
        <Section title="Details">
          <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5 text-sm">
                <DollarSign
                  className={`h-4 w-4 ${price > 0 ? "text-lime" : "text-muted-foreground"}`}
                />
                <span className="font-medium">Paid game</span>
              </span>
              <button
                type="button"
                onClick={() => setPrice(price > 0 ? 0 : 10)}
                className={`relative h-6 w-10 rounded-full transition-colors ${price > 0 ? "bg-lime" : "bg-secondary"}`}
                aria-label="Toggle paid game"
              >
                <motion.span
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow"
                  style={{ left: price > 0 ? "calc(100% - 1.375rem)" : "0.125rem" }}
                />
              </button>
            </div>
            {price > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Entry fee
                </span>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    min={1}
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full rounded-xl border border-border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:border-lime"
                  />
                </div>
                <span className="text-xs text-muted-foreground">per player</span>
              </div>
            )}
          </div>
          <Toggle
            icon={<Home className="h-4 w-4" />}
            label="Indoor venue"
            value={indoor}
            onChange={setIndoor}
          />
          <Toggle
            icon={<Lock className="h-4 w-4" />}
            label="Private (invite only)"
            value={priv}
            onChange={setPriv}
          />
          <Toggle
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Require my approval to join"
            value={requiresApproval}
            onChange={setRequiresApproval}
            right={user ? undefined : "Sign in"}
          />
          {requiresApproval && (
            <p className="px-1 text-[11px] text-muted-foreground">
              Players send a pickup request and you approve or decline each one from the game page.
            </p>
          )}
          <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <label
              htmlFor="create-signup-cutoff"
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <Clock3 className="h-4 w-4" /> Signup cutoff
            </label>
            <select
              id="create-signup-cutoff"
              value={String(signupCutoffMin)}
              onChange={(e) => setSignupCutoffMin(Number(e.target.value) || 0)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
            >
              {SIGNUP_CUTOFF_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              New signups close automatically this long before start. The game then shows
              "Signup closed", and "In progress" once it starts.
            </p>
          </div>
        </Section>

        {/* Description */}
        <Section title="Description">
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Format, vibe, what to bring..."
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime resize-none"
          />
        </Section>

        <motion.button
          whileTap={{ scale: 0.98 }}
          type="submit"
          disabled={publishing || !selectedAffiliation}
          className="w-full rounded-2xl bg-lime-gradient py-4 font-bold text-primary-foreground glow-lime disabled:opacity-60"
        >
          {publishing
            ? "Publishing…"
            : !selectedAffiliation
              ? "Choose a team or gym profile to continue"
              : "Publish game"}
        </motion.button>
        <p className="text-center text-xs text-muted-foreground pb-6">
          Hosting is free. Pro hosts get unlimited games + analytics.
        </p>
        </fieldset>

      </form>
    </div>
  );
}

function Section({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}


function Toggle({
  icon,
  label,
  value,
  onChange,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  right?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm"
    >
      <span className="flex items-center gap-2.5">
        <span className={value ? "text-lime" : "text-muted-foreground"}>{icon}</span>
        <span className="font-medium">{label}</span>
      </span>
      <span className="flex items-center gap-2">
        {right && <span className="text-xs text-muted-foreground">{right}</span>}
        <span
          className={`relative h-6 w-10 rounded-full transition-colors ${value ? "bg-lime" : "bg-secondary"}`}
        >
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow"
            style={{ left: value ? "calc(100% - 1.375rem)" : "0.125rem" }}
          />
        </span>
      </span>
    </button>
  );
}
