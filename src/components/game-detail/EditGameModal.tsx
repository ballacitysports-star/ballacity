import { Check, X as XIcon, Lock, DollarSign, Home, ShieldCheck } from "lucide-react";
import { SPORTS, imageFor } from "@/lib/sample-data";
import { TierChips } from "@/components/sports/TierChips";
import { AgeRequirementFields } from "@/components/games/AgeRequirementFields";
import { formatWhenDate } from "@/lib/format";
import { gameEndsAt } from "@/lib/game-time";
import { GamePolicyFields } from "@/components/games/GamePolicyFields";
import { normalizeGamePolicy, validateGamePolicy, type GamePolicy } from "@/lib/game-policy";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import {
  getGamePaymentSettings,
  upsertGamePaymentSettings,
  listMyPaymentMethods,
  paymentTypeMeta,
  type PaymentMethod,
  type GamePaymentSettings,
} from "@/lib/payments";
import { PAYMENT_HOLD_OPTIONS } from "@/lib/payment-hold";
import { geocodeAddress } from "@/lib/geocode.functions";
import { updateHostedGame } from "@/lib/hosted-games-store";
import {
  ANY_SKILL,
  parseSkillTiers,
  scaleForSport,
  serializeSkillTiers,
  toggleSkillTier,
} from "@/lib/sport-levels";
import type { Game } from "@/lib/sample-data";
import { PositionsPicker, positionsCleanup } from "@/components/PositionsPicker";
import { listMyTeams } from "@/lib/teams.functions";
import { listMyOrgs } from "@/lib/trainer-orgs.functions";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { computeLiveStatus } from "@/lib/live-status";
import { useAuth } from "@/hooks/use-auth";
import { createNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { buildMediaRef } from "@/lib/media-refs";
import { isAllowedImageMime, MAX_IMAGE_BYTES } from "@/lib/image-validation";
import { finalizeImageUpload } from "@/lib/image-uploads.functions";
import { useBlockedUsersList } from "@/lib/moderation";
import { Field, formatEndsAt } from "@/components/game-detail/GameDetailBits";

export function EditGameModal({
  game,
  hostId,
  settings,
  onClose,
  onSettingsSaved,
}: {
  game: Game;
  hostId: string;
  settings: GamePaymentSettings | null;
  onClose: () => void;
  onSettingsSaved: (s: GamePaymentSettings) => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState(game.title);
  const [sport, setSport] = useState<Game["sport"]>(game.sport);
  const [skill, setSkill] = useState<Game["skill"]>(game.skill);
  // Tier list follows the game's sport, matching the profile scale.
  const selectedSkillTiers = parseSkillTiers(sport, skill);
  const skillMulti = scaleForSport(sport).multi ?? false;
  useEffect(() => {
    if (skill === ANY_SKILL) return;
    const kept = serializeSkillTiers(sport, parseSkillTiers(sport, skill));
    if (kept !== skill) setSkill(kept);
  }, [sport, skill]);
  const [location, setLocation] = useState(game.location);
  const [neighborhood, setNeighborhood] = useState(game.neighborhood ?? "");
  const [dateLocal, setDateLocal] = useState(() => {
    const d = new Date(game.date);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [duration] = useState(game.duration);
  const [allDay, setAllDay] = useState(!!game.allDay);
  const [endLocal, setEndLocal] = useState(() => toLocalInput(gameEndsAt(game)));
  const [maxPlayers, setMaxPlayers] = useState<number>(
    Math.max(2, Math.min(30, Number(game.maxPlayers) || 10)),
  );
  const [price, setPrice] = useState<number>(Math.max(0, Number(game.price) || 0));
  const [indoor, setIndoor] = useState(!!game.indoor);
  const [isPrivate, setIsPrivate] = useState(!!game.isPrivate);
  const [image, setImage] = useState(game.image ?? "");
  const [description, setDescription] = useState(game.description);
  const [positionsNeeded, setPositionsNeeded] = useState<Record<string, number>>(
    game.positionsNeeded ?? {},
  );
  const [requiresApproval, setRequiresApproval] = useState<boolean>(
    settings ? !!settings.requires_approval : true,
  );
  const [minAge, setMinAge] = useState<number | null>(game.minAge ?? null);
  const [maxAge, setMaxAge] = useState<number | null>(game.maxAge ?? null);
  const [acceptedMethodIds, setAcceptedMethodIds] = useState<Set<string>>(
    () => new Set(settings?.accepted_method_ids ?? []),
  );
  const [paymentHoldMinutes, setPaymentHoldMinutes] = useState<number | null>(
    settings?.payment_hold_minutes ?? null,
  );
  const [paymentDeadline, setPaymentDeadline] = useState<string>(
    settings?.payment_deadline ? settings.payment_deadline.slice(0, 16) : "",
  );
  const [refundPolicy, setRefundPolicy] = useState<string>(settings?.refund_policy ?? "");
  // Shared policy editor state. maxPlayers / refundPolicy stay mirrored into
  // the existing save payload so nothing downstream changes shape.
  const [editPolicy, setEditPolicy] = useState<GamePolicy>(() =>
    normalizeGamePolicy({
      cancellationPolicy: (game.cancellationPolicy ??
        undefined) as GamePolicy["cancellationPolicy"],
      cancellationNotes: game.cancellationNotes ?? "",
      minPlayers: game.minPlayers ?? 0,
      maxPlayers: Math.max(2, Math.min(30, Number(game.maxPlayers) || 10)),
      allowWaitlist: game.allowWaitlist ?? true,
      entryFee: Number(settings?.entry_fee ?? game.price ?? 0) || 0,
      requiresApproval: settings ? !!settings.requires_approval : true,
      refundRule: (settings?.refund_rule ?? undefined) as GamePolicy["refundRule"],
      lateRefundPct: settings?.late_refund_pct ?? 0,
      cancelCutoffMin: game.cancelCutoffMin,
      refundPolicy: settings?.refund_policy ?? "",
      gameRules: game.gameRules ?? "",
    }),
  );
  const applyPolicy = (next: GamePolicy) => {
    setEditPolicy(next);
    setMaxPlayers(next.maxPlayers);
    setRefundPolicy(next.refundPolicy);
  };
  const [paymentInstructions, setPaymentInstructions] = useState<string>(
    settings?.payment_instructions ?? "",
  );
  const [myMethods, setMyMethods] = useState<PaymentMethod[]>([]);
  const [coverUploading, setCoverUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Host-as (team/gym) — only editable before the game starts.
  const hasStarted = computeLiveStatus(game) !== "scheduled";
  const geocode = useServerFn(geocodeAddress);
  const fetchMyTeams = useServerFn(listMyTeams);
  const fetchMyOrgs = useServerFn(listMyOrgs);
  const myTeamsQuery = useQuery({
    queryKey: ["my-teams", user?.id ?? "anon"],
    queryFn: () => fetchMyTeams(),
    enabled: !!user && !hasStarted,
    staleTime: 30_000,
  });
  const myOrgsQuery = useQuery({
    queryKey: ["my-orgs", user?.id ?? "anon"],
    queryFn: () => fetchMyOrgs(),
    enabled: !!user && !hasStarted,
    staleTime: 30_000,
  });
  type EditAffiliation = {
    source: "team" | "org";
    id: string;
    name: string;
    kind?: "team" | "coach";
  };
  const editAffiliations: EditAffiliation[] = [
    ...(myTeamsQuery.data ?? []).map((t) => ({
      source: "team" as const,
      id: t.id,
      name: t.name,
      kind: t.kind,
    })),
    ...(myOrgsQuery.data ?? []).map((o) => ({ source: "org" as const, id: o.id, name: o.name })),
  ];
  const affLabel = (a: EditAffiliation) =>
    a.source === "org" ? "Gym" : a.kind === "coach" ? "Trainer" : "Team";
  const initialAff: EditAffiliation | null = game.teamId
    ? { source: "team", id: game.teamId, name: "", kind: "team" }
    : game.orgId
      ? { source: "org", id: game.orgId, name: "" }
      : null;
  const [selectedAff, setSelectedAff] = useState<EditAffiliation | null>(initialAff);
  useEffect(() => {
    if (!selectedAff) return;
    const match = editAffiliations.find(
      (a) => a.source === selectedAff.source && a.id === selectedAff.id,
    );
    if (match && match.name && !selectedAff.name) setSelectedAff(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAffiliations.length]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const m = await listMyPaymentMethods();
        if (!cancel) setMyMethods(m.filter((x) => x.is_enabled));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const policyCheck = validateGamePolicy({
        ...editPolicy,
        entryFee: Math.max(0, Number(price) || 0),
        requiresApproval,
      });
      if (!policyCheck.ok) {
        toast.error(policyCheck.error);
        setSaving(false);
        return;
      }
      const mp = Math.max(2, Math.min(30, Number(maxPlayers) || game.maxPlayers));
      const pr = Math.max(0, Number(price) || 0);
      const iso = new Date(dateLocal).toISOString();
      const startMs = new Date(dateLocal).getTime();
      const endMs = new Date(endLocal).getTime();
      if (!allDay && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
        toast.error("End time must be after the start time.");
        return;
      }
      const nextDurationMin =
        !allDay && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
          ? Math.round((endMs - startMs) / 60000)
          : null;
      // Re-resolve venue coordinates whenever the host edits the address so
      // viewer-relative distance stays accurate.
      const nextLocation = location.trim() || game.location;
      let venue: { lat: number; lng: number } | null = null;
      let venueChanged = false;
      if (nextLocation !== game.location) {
        venueChanged = true;
        try {
          const res = await geocode({ data: { address: nextLocation } });
          venue = { lat: res.lat, lng: res.lng };
        } catch {
          venue = null;
        }
      }
      const trimmedImage = image.trim();
      const finalImage = trimmedImage || imageFor(sport);
      const updated = await updateHostedGame(game.id, {
        title: title.trim() || game.title,
        sport,
        skill,
        minAge,
        maxAge,
        location: nextLocation,
        neighborhood: neighborhood.trim(),
        ...(venueChanged ? { lat: venue?.lat ?? null, lng: venue?.lng ?? null } : {}),
        date: Number.isFinite(new Date(dateLocal).getTime()) ? iso : game.date,
        duration: nextDurationMin ? `${nextDurationMin} min` : duration.trim() || game.duration,
        endsAt: allDay ? null : Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
        allDay,
        maxPlayers: mp,
        minPlayers: Math.min(editPolicy.minPlayers, mp),
        allowWaitlist: editPolicy.allowWaitlist,
        cancellationPolicy: editPolicy.cancellationPolicy,
        cancellationNotes: editPolicy.cancellationNotes || null,
        cancelCutoffMin: editPolicy.cancelCutoffMin,
        gameRules: editPolicy.gameRules || null,
        price: pr,
        indoor,
        isPrivate,
        image: finalImage,
        description,
        positionsNeeded: positionsCleanup(positionsNeeded),
        ...(hasStarted
          ? {}
          : {
              teamId: selectedAff?.source === "team" ? selectedAff.id : null,
              orgId: selectedAff?.source === "org" ? selectedAff.id : null,
            }),
      } as Partial<Game>).catch((err: unknown) => {
        toast.error((err as { message?: string } | null)?.message ?? "Couldn't save changes.");
        return undefined;
      });
      if (!updated) {
        return;
      }

      try {
        await upsertGamePaymentSettings({
          game_id: game.id,
          entry_fee: pr,
          accepted_method_ids: pr > 0 ? Array.from(acceptedMethodIds) : [],
          payment_deadline: paymentDeadline ? new Date(paymentDeadline).toISOString() : null,
          // Only send the hold when it's set or the column is already live, so
          // this save still works if the client ships before the migration.
          ...(paymentHoldMinutes !== null || (settings && "payment_hold_minutes" in settings)
            ? { payment_hold_minutes: pr > 0 ? paymentHoldMinutes : null }
            : {}),
          refund_policy: refundPolicy.trim() || null,
          ...(pr > 0
            ? { refund_rule: editPolicy.refundRule, late_refund_pct: editPolicy.lateRefundPct }
            : {}),
          payment_instructions: paymentInstructions.trim() || null,
          requires_approval: requiresApproval,
        });
        const next = await getGamePaymentSettings(game.id);
        if (next) onSettingsSaved(next);
      } catch (err: unknown) {
        toast.error(
          (err as { message?: string } | null)?.message ??
            "Saved game, but couldn't update host settings.",
        );
      }

      // Notify confirmed players when the schedule end changed (end time or
      // all-day toggle) — their plans and calendar invites depend on it.
      const prevEndMs = gameEndsAt(game);
      const nextEndMs = allDay ? prevEndMs : Number.isFinite(endMs) ? endMs : prevEndMs;
      const endChanged = !allDay && nextEndMs !== prevEndMs;
      const allDayChanged = !!game.allDay !== allDay;
      if (endChanged || allDayChanged) {
        void (async () => {
          try {
            const { data: roster } = await supabase
              .from("game_participants")
              .select("user_id")
              .eq("game_id", game.id);
            const targets = (roster ?? [])
              .map((r: { user_id: string }) => String(r.user_id))
              .filter((uid) => uid && uid !== user?.id);
            const body = allDayChanged
              ? allDay
                ? `${title.trim() || game.title} is now an all-day event on ${formatWhenDate(game.date)}.`
                : `${title.trim() || game.title} now ends at ${formatEndsAt({
                    ...game,
                    allDay,
                    endsAt: new Date(nextEndMs).toISOString(),
                  } as Game)}.`
              : `New end time: ${formatEndsAt({
                  ...game,
                  allDay,
                  endsAt: new Date(nextEndMs).toISOString(),
                } as Game)}.`;
            await Promise.all(
              targets.map((uid) =>
                createNotification({
                  user_id: uid,
                  type: "game_time_changed",
                  title: `Schedule updated: ${title.trim() || game.title}`,
                  body,
                  link: `/games/${game.id}`,
                }).catch(() => {}),
              ),
            );
          } catch {
            /* best effort */
          }
        })();
      }

      toast.success("Game updated.");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[min(100%,40rem)] rounded-2xl border border-border bg-surface p-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Edit game</h2>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-border"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 space-y-4">
          {/* Host as (team/gym) — locked once the game starts */}
          <Field label={hasStarted ? "Host as (locked — game has started)" : "Host as"}>
            {hasStarted ? (
              <div className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                {game.teamId ? "Team" : game.orgId ? "Gym" : "Personal"} affiliation is locked after
                the game starts.
              </div>
            ) : editAffiliations.length === 0 ? (
              <div className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                No teams or gyms available.
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
                {editAffiliations.map((a) => {
                  const active = selectedAff?.source === a.source && selectedAff.id === a.id;
                  return (
                    <button
                      type="button"
                      key={`${a.source}:${a.id}`}
                      onClick={() => setSelectedAff(a)}
                      className={`shrink-0 flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
                        active
                          ? "border-lime bg-lime/10 text-lime"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-surface text-xs font-bold">
                        {(a.name || "?").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="truncate max-w-[10rem]">{a.name || "Loading…"}</span>
                      <span className="micro-label opacity-70">{affLabel(a)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {/* Sport grid */}
          <Field label="Sport">
            <div className="grid grid-cols-3 gap-2">
              {SPORTS.map((s) => {
                const active = sport === s.name;
                return (
                  <button
                    type="button"
                    key={s.name}
                    onClick={() => {
                      setSport(s.name);
                      setPositionsNeeded({});
                    }}
                    className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-semibold transition-all ${
                      active
                        ? "border-lime bg-lime/10 text-lime"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    <span className="text-2xl">{s.emoji}</span>
                    <span>{s.name}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Cover photo */}
          <Field label="Cover photo">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-background">
              <img
                src={image || imageFor(sport)}
                alt="Game cover preview"
                className="h-32 w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2">
                <span className="text-[11px] text-white/90">
                  {image ? "Custom cover" : "Default cover"}
                </span>
                <div className="flex items-center gap-2">
                  {image && (
                    <button
                      type="button"
                      onClick={() => setImage("")}
                      className="grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white"
                      aria-label="Remove cover"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={coverUploading || !user}
                    onClick={() => coverInputRef.current?.click()}
                    className="rounded-full bg-lime px-3 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-60"
                  >
                    {coverUploading ? "Uploading…" : image ? "Replace" : "Upload"}
                  </button>
                </div>
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file || !user) return;
                  const ext = (file.name.split(".").pop() || "").toLowerCase();
                  if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
                    toast.error("Please choose a JPG, PNG or WEBP image.");
                    return;
                  }
                  if (file.type && !isAllowedImageMime(file.type)) {
                    toast.error("Please choose a JPG, PNG or WEBP image.");
                    return;
                  }
                  if (file.size > MAX_IMAGE_BYTES) {
                    toast.error("Image too large (max 8MB).");
                    return;
                  }
                  setCoverUploading(true);
                  try {
                    const path = `${user.id}/${Date.now()}-${Math.random()
                      .toString(36)
                      .slice(2, 8)}.${ext}`;
                    const { error: upErr } = await supabase.storage
                      .from("game-covers")
                      .upload(path, file, { cacheControl: "3600", upsert: false });
                    if (upErr) throw upErr;
                    // Server re-validates the stored bytes and safety-scans them.
                    const check = await finalizeImageUpload({
                      data: { bucket: "game-covers", path },
                    });
                    if (check?.quarantined) {
                      throw new Error(
                        "This image was flagged by our automated safety check and is pending review.",
                      );
                    }
                    // Persist a reference, not a long-lived signed URL.
                    setImage(buildMediaRef("game-covers", path));
                  } catch (err: unknown) {
                    toast.error((err as { message?: string } | null)?.message ?? "Upload failed");
                  } finally {
                    setCoverUploading(false);
                  }
                }}
              />
            </div>
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="Or paste image URL…"
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs"
            />
          </Field>

          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Venue address">
            <LocationAutocomplete
              value={location}
              onChange={setLocation}
              placeholder="Search court, park or venue"
            />
          </Field>

          <Field label="Neighborhood">
            <input
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          {/* Skill chips */}
          <Field label={`Skill level · ${scaleForSport(sport).system}`}>
            <TierChips
              scale={scaleForSport(sport)}
              selected={selectedSkillTiers}
              size="lg"
              ariaPrefix={sport}
              onToggle={(tier) => setSkill(toggleSkillTier(sport, skill, tier))}
              leading={
                <button
                  type="button"
                  aria-pressed={selectedSkillTiers.length === 0}
                  onClick={() => setSkill(ANY_SKILL)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold ${
                    selectedSkillTiers.length === 0
                      ? "border-lime bg-lime text-primary-foreground"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {ANY_SKILL}
                </button>
              }
            />
            {skillMulti && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Pick a level in each football format — selections combine.
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date & time">
              <input
                type="datetime-local"
                value={dateLocal}
                onChange={(e) => setDateLocal(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm [color-scheme:dark]"
              />
            </Field>
            <Field label="Ends (date & time)">
              <input
                type="datetime-local"
                value={endLocal}
                min={dateLocal}
                disabled={allDay}
                onChange={(e) => setEndLocal(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm [color-scheme:dark] disabled:opacity-50"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAllDay((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                allDay
                  ? "border-lime bg-lime/10 text-lime"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              All-day event
            </button>
            {!allDay &&
              [60, 90, 120, 180].map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => {
                    const start = new Date(dateLocal).getTime();
                    if (Number.isFinite(start)) setEndLocal(toLocalInput(start + min * 60000));
                  }}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                >
                  {min < 120 ? `${min} min` : `${min / 60} h`}
                </button>
              ))}
          </div>

          {/* Game policy: limits, waitlist, cancellation, refunds, rules */}
          <Field label="Game policy">
            <GamePolicyFields
              value={{
                ...editPolicy,
                entryFee: Math.max(0, Number(price) || 0),
                requiresApproval,
                refundPolicy,
              }}
              onChange={applyPolicy}
              idPrefix="edit-policy"
            />
          </Field>

          {/* Paid game toggle */}
          <Field label="Details">
            <div className="rounded-2xl border border-border bg-background px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm">
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
                  <span
                    className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all"
                    style={{ left: price > 0 ? "calc(100% - 1.375rem)" : "0.125rem" }}
                  />
                </button>
              </div>
              {price > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                      className="w-full rounded-xl border border-border bg-surface pl-7 pr-3 py-1.5 text-sm outline-none focus:border-lime"
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">per player</span>
                </div>
              )}
            </div>
            <EditToggle
              icon={<Home className="h-4 w-4" />}
              label="Indoor venue"
              value={indoor}
              onChange={setIndoor}
            />
            <EditToggle
              icon={<Lock className="h-4 w-4" />}
              label="Private (invite only)"
              value={isPrivate}
              onChange={setIsPrivate}
            />
            <EditToggle
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Require my approval to join"
              value={requiresApproval}
              onChange={setRequiresApproval}
            />
            {requiresApproval && (
              <p className="px-1 text-[11px] text-muted-foreground">
                Players send a pickup request and you approve or decline each one.
              </p>
            )}
            <AgeRequirementFields
              minAge={minAge}
              maxAge={maxAge}
              onChange={(n) => {
                setMinAge(n.minAge);
                setMaxAge(n.maxAge);
              }}
              idPrefix="edit-age"
            />
          </Field>

          {price > 0 && (
            <Field label="Accepted payment methods">
              {myMethods.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-coral/40 bg-coral/5 p-3 text-xs">
                  <div className="font-semibold text-coral">No payment methods yet</div>
                  <p className="mt-1 text-muted-foreground">
                    Add Venmo, Cash App, Zelle, or others in the Payments tab so players can pay.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {myMethods.map((m) => {
                    const meta = paymentTypeMeta(m.payment_type);
                    const on = acceptedMethodIds.has(m.id);
                    return (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => {
                          const n = new Set(acceptedMethodIds);
                          if (on) n.delete(m.id);
                          else n.add(m.id);
                          setAcceptedMethodIds(n);
                        }}
                        className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left ${
                          on ? "border-lime bg-lime/5" : "border-border bg-background"
                        }`}
                      >
                        <div className="grid h-8 w-8 place-items-center rounded-xl bg-secondary text-base">
                          {meta.emoji}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">
                            {m.label || meta.name}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {m.username || m.contact_info}
                          </div>
                        </div>
                        <div
                          className={`grid h-5 w-5 place-items-center rounded-full ${
                            on ? "bg-lime text-primary-foreground" : "border border-border"
                          }`}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
          )}

          {price > 0 && (
            <Field label="Payment deadline (optional)">
              <input
                type="datetime-local"
                value={paymentDeadline}
                onChange={(e) => setPaymentDeadline(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm [color-scheme:dark]"
              />
            </Field>
          )}

          {price > 0 && (
            <Field label="Hold approved spots for">
              <select
                value={paymentHoldMinutes ?? ""}
                onChange={(e) =>
                  setPaymentHoldMinutes(e.target.value ? Number(e.target.value) : null)
                }
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              >
                {PAYMENT_HOLD_OPTIONS.map((o) => (
                  <option key={o.label} value={o.minutes ?? ""}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Approved players who haven't sent payment by then lose the spot, and the next player
                on the waitlist is notified. Holds never release after tip-off.
              </p>
            </Field>
          )}

          {price > 0 && (
            <Field label="Payment instructions (optional)">
              <textarea
                value={paymentInstructions}
                onChange={(e) => setPaymentInstructions(e.target.value)}
                rows={2}
                placeholder="e.g. Include your full name in the payment note."
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none"
              />
            </Field>
          )}

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Positions needed">
            <PositionsPicker sport={sport} value={positionsNeeded} onChange={setPositionsNeeded} />
          </Field>
        </div>
        <BlockedUsersSection hostId={hostId} />
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-xl border border-border bg-background py-2.5 text-sm font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-xl bg-lime-gradient py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditToggle({
  icon,
  label,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="mt-2 flex w-full items-center justify-between rounded-2xl border border-border bg-background px-3 py-2.5 text-sm"
    >
      <span className="flex items-center gap-2">
        <span className={value ? "text-lime" : "text-muted-foreground"}>{icon}</span>
        <span className="font-medium">{label}</span>
      </span>
      <span
        className={`relative h-6 w-10 rounded-full transition-colors ${value ? "bg-lime" : "bg-secondary"}`}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all"
          style={{ left: value ? "calc(100% - 1.375rem)" : "0.125rem" }}
        />
      </span>
    </button>
  );
}

/** ms -> value for a <input type="datetime-local"> in local time. */
function toLocalInput(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function BlockedUsersSection({ hostId }: { hostId: string }) {
  const { users, loading, unblock, unblocking } = useBlockedUsersList();

  if (!hostId) return null;

  return (
    <div className="mt-4 rounded-xl border border-border bg-background p-3">
      <div className="micro-label text-muted-foreground mb-2">Blocked accounts</div>
      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : users.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          You haven&apos;t blocked anyone. Blocked accounts can&apos;t ask to join your games,
          message you or follow you.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold truncate">{u.displayName}</span>
              <button
                type="button"
                disabled={unblocking}
                onClick={() =>
                  void unblock(u.id).then(
                    () => toast.success(`${u.displayName} unblocked.`),
                    () => toast.error("Couldn't unblock. Try again."),
                  )
                }
                className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-semibold hover:bg-secondary disabled:opacity-60"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
