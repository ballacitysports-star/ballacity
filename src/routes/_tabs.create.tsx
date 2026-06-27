import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Calendar, MapPin, Users, DollarSign, Lock, Home, ShieldCheck } from "lucide-react";
import { SPORTS, type Sport } from "@/lib/sample-data";
import { addHostedGame } from "@/lib/hosted-games-store";
import { useServerFn } from "@tanstack/react-start";
import { reverseGeocode } from "@/lib/geocode.functions";

import { toast } from "sonner";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { useMyProfile } from "@/lib/user-prefs-store";
import { useAuth } from "@/hooks/use-auth";
import { upsertGamePaymentSettings } from "@/lib/payments";


export const Route = createFileRoute("/_tabs/create")({
  head: () => ({ meta: [{ title: "Host a game — OpenRun" }] }),
  component: Create,
});

function Create() {
  const nav = useNavigate();
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const [sport, setSport] = useState<Sport>("Basketball");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState(profile?.city ?? "");
  const previousProfileCityRef = useRef(profile?.city ?? "");
  const locationEditedRef = useRef(false);
  const [skill, setSkill] = useState<"All Levels" | "Beginner" | "Intermediate" | "Advanced">(
    "All Levels",
  );
  const [size, setSize] = useState(10);
  const [price, setPrice] = useState(0);
  const [indoor, setIndoor] = useState(false);
  const [priv, setPriv] = useState(false);
  const [description, setDescription] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    const nextCity = profile?.city?.trim() ?? "";
    const previousCity = previousProfileCityRef.current;
    if (nextCity === previousCity) return;
    previousProfileCityRef.current = nextCity;

    if (!nextCity) return;
    // Profile city changed — re-autopopulate and clear the manual-edit flag
    // so subsequent profile changes keep working.
    locationEditedRef.current = false;
    setLocation(nextCity);
  }, [profile?.city]);

  // Auto-fill the venue address from the device's current GPS location when
  // the user hasn't typed anything yet and has no saved profile city. Runs
  // once on mount; manual edits or a later profile-city sync take precedence.
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
          const { formatted, city } = await reverse({
            data: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          const next = formatted || city;
          if (next && !cancelled && !locationEditedRef.current) {
            setLocation(next);
          }
        } catch {
          /* silent — user can still type manually */
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
    return () => { cancelled = true; };
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
          setPublishing(true);
          try {
            const date = when
              ? new Date(when).toISOString()
              : new Date(Date.now() + 3600_000).toISOString();
            const game = addHostedGame({
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
              host: profile
                ? { name: profile.name, username: profile.username, avatar: profile.avatar, rating: profile.stats.sportsmanship }
                : undefined,
            });

            // Persist host ownership + approval/fee preferences so the host & players see them on the detail page
            if (user) {
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
            toast.success("Game published");
            nav({ to: "/games/$gameId", params: { gameId: game.id } });
          } finally {
            setPublishing(false);
          }
        }}
        className="space-y-5"
      >
        {/* Sport */}
        <Section title="Sport">
          <div className="grid grid-cols-3 gap-2">
            {SPORTS.map((s) => {
              const active = sport === s.name;
              return (
                <button
                  type="button"
                  key={s.name}
                  onClick={() => setSport(s.name)}
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
        <Section title="When" icon={<Calendar className="h-4 w-4" />}>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime [color-scheme:dark]"
          />
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
        <Section title="Skill level">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {(["All Levels", "Beginner", "Intermediate", "Advanced"] as const).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setSkill(s)}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${
                  skill === s
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
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
          disabled={publishing}
          className="w-full rounded-2xl bg-lime-gradient py-4 font-bold text-primary-foreground glow-lime disabled:opacity-60"
        >
          {publishing ? "Publishing…" : "Publish game"}
        </motion.button>
        <p className="text-center text-xs text-muted-foreground pb-6">
          Hosting is free. Pro hosts get unlimited games + analytics.
        </p>
      </form>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
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
