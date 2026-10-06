import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, MapPin, Minus, Plus, Search } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { VenueMapPreview } from "@/components/VenueMapPreview";
import { ImageUploader } from "@/components/ImageUploader";
import { HoursEditor } from "@/components/org/HoursEditor";
import { PhotoGalleryEditor } from "@/components/org/PhotoGalleryEditor";
import { ProfileStrengthMeter } from "@/components/org/ProfileStrengthMeter";
import { ListingPreviewCard } from "@/components/org/ListingPreviewCard";
import { detectTimezone, emptyHours, resolveOpenState, type OrgHours } from "@/lib/org-hours";
import {
  MAX_COURT_COUNT,
  MAX_ORG_AMENITIES,
  ORG_AMENITY_GROUPS,
  ORG_CATEGORIES,
  courtCountFromAmenities,
  isValidPhone,
  scoreListing,
  suggestHandle,
  websiteHref,
  withCourtCount,
} from "@/lib/org-listing";
import { autocompletePlaces, getPlaceDetails, type PlaceSuggestion } from "@/lib/places.functions";

function randomToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export type OrgFormValue = {
  name: string;
  handle: string;
  city: string;
  bio: string;
  website: string;
  address: string;
  placeId: string;
  geo: { lat: number; lng: number } | null;
  avatarUrl: string;
  coverUrl: string;
  phone: string;
  email: string;
  category: string;
  amenities: string[];
  photos: string[];
  hours: OrgHours;
  timezone: string;
};

export function emptyOrgForm(): OrgFormValue {
  return {
    name: "",
    handle: "",
    city: "",
    bio: "",
    website: "",
    address: "",
    placeId: "",
    geo: null,
    avatarUrl: "",
    coverUrl: "",
    phone: "",
    email: "",
    category: "",
    amenities: [],
    photos: [],
    hours: emptyHours(),
    timezone: "",
  };
}

const HANDLE_RE = /^[a-z0-9_-]{3,40}$/;

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function supportedTimezones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    return fn ? fn("timeZone") : [];
  } catch {
    return [];
  }
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateOrgForm(v: OrgFormValue): string | null {
  if (v.name.trim().length < 2) return "Name is too short.";
  if (!HANDLE_RE.test(v.handle.trim().toLowerCase()))
    return "Handle must be 3–40 chars: a–z, 0–9, - or _.";
  if (v.website.trim() && !websiteHref(v.website))
    return "Enter a valid website (e.g. example.com).";
  if (v.phone && !isValidPhone(v.phone)) return "Phone number looks invalid.";
  if (v.email && !EMAIL_RE.test(v.email.trim())) return "Email looks invalid.";
  if (v.timezone.trim() && !isValidTimezone(v.timezone.trim()))
    return "Timezone isn't recognized (e.g. America/New_York).";
  if (v.amenities.length > MAX_ORG_AMENITIES) return `Pick at most ${MAX_ORG_AMENITIES} amenities.`;
  return null;
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-20 rounded-2xl border border-border bg-surface p-4 space-y-3"
    >
      <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const inputCls =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime/60";

/**
 * Google Business Profile–style gym listing editor. Used by both the create
 * and edit routes so the two screens can never drift apart.
 */
export function OrgForm({
  value,
  onChange,
  userId,
  submitting,
  onSubmit,
  onDelete,
  submitLabel,
}: {
  value: OrgFormValue;
  onChange: (v: OrgFormValue) => void;
  userId: string | null | undefined;
  submitting: boolean;
  onSubmit: () => void;
  onDelete?: () => void;
  submitLabel: string;
}) {
  const [touched, setTouched] = useState(false);
  const err = touched ? validateOrgForm(value) : null;

  const autocomplete = useServerFn(autocompletePlaces);
  const placeDetails = useServerFn(getPlaceDetails);
  const [nameSuggestions, setNameSuggestions] = useState<PlaceSuggestion[]>([]);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameLoading, setNameLoading] = useState(false);
  const sessionTokenRef = useRef<string>(randomToken());
  const biasRef = useRef<{ lat: number; lng: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const reqIdRef = useRef(0);

  const handleAutoRef = useRef(!value.handle);
  const courtCount = courtCountFromAmenities(value.amenities);
  const timezones = useMemo(() => supportedTimezones(), []);
  const openNow = useMemo(
    () => resolveOpenState(value.hours, value.timezone),
    [value.hours, value.timezone],
  );

  const strength = useMemo(
    () =>
      scoreListing({
        name: value.name,
        handle: value.handle,
        category: value.category,
        address: value.address,
        phone: value.phone,
        email: value.email,
        website: value.website,
        bio: value.bio,
        hours: value.hours,
        amenities: value.amenities,
        photos: value.photos,
        avatarUrl: value.avatarUrl,
        coverUrl: value.coverUrl,
      }),
    [value],
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        biasRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Default the listing timezone to the device's, so open/closed is sensible.
  useEffect(() => {
    if (!value.timezone) onChange({ ...value, timezone: detectTimezone() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.timezone]);

  function patch(p: Partial<OrgFormValue>) {
    onChange({ ...value, ...p });
  }

  const queryNameSuggestions = async (input: string) => {
    if (input.trim().length < 2) {
      setNameSuggestions([]);
      setNameOpen(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setNameLoading(true);
    try {
      const { suggestions } = await autocomplete({
        data: {
          input,
          lat: biasRef.current?.lat ?? null,
          lng: biasRef.current?.lng ?? null,
          sessionToken: sessionTokenRef.current,
        },
      });
      if (reqId !== reqIdRef.current) return;
      setNameSuggestions(suggestions);
      setNameOpen(suggestions.length > 0);
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      console.error("[OrgForm] name autocomplete failed:", e);
      setNameSuggestions([]);
      setNameOpen(false);
    } finally {
      if (reqId === reqIdRef.current) setNameLoading(false);
    }
  };

  const handleNameChange = (v: string) => {
    patch(handleAutoRef.current ? { name: v, handle: suggestHandle(v) } : { name: v });
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => queryNameSuggestions(v), 250);
  };

  const pickNameSuggestion = (s: PlaceSuggestion) => {
    const fallbackAddress = s.secondary ? `${s.primary}, ${s.secondary}` : s.primary;
    patch({
      name: s.primary,
      address: fallbackAddress,
      placeId: s.id,
      ...(handleAutoRef.current ? { handle: suggestHandle(s.primary) } : {}),
    });
    setNameOpen(false);
    setNameSuggestions([]);
    const tokenAtPick = sessionTokenRef.current;
    sessionTokenRef.current = randomToken();
    placeDetails({ data: { placeId: s.id, sessionToken: tokenAtPick } })
      .then((d) => {
        onChange({
          ...value,
          name: s.primary,
          address: d.formattedAddress || fallbackAddress,
          placeId: s.id,
          geo: { lat: d.lat, lng: d.lng },
          category: value.category || "Gym",
          ...(handleAutoRef.current ? { handle: suggestHandle(s.primary) } : {}),
        });
      })
      .catch((e) => {
        console.error("[OrgForm] place details failed:", e);
      });
  };

  const preview = (
    <ListingPreviewCard
      v={{
        name: value.name,
        category: value.category,
        handle: value.handle,
        address: value.address,
        city: value.city,
        phone: value.phone,
        website: value.website,
        avatarUrl: value.avatarUrl,
        coverUrl: value.coverUrl,
        photos: value.photos,
        amenities: value.amenities,
        hours: value.hours,
        timezone: value.timezone,
        geo: value.geo,
        placeId: value.placeId,
      }}
      compact
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
      <div className="space-y-5">
        <ProfileStrengthMeter percent={strength.percent} items={strength.items} />

        <Section id="org-business" title="Business info">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Name</span>
            <div className="relative">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <input
                  value={value.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  onFocus={() => nameSuggestions.length > 0 && setNameOpen(true)}
                  onBlur={() => setTimeout(() => setNameOpen(false), 150)}
                  placeholder="Search a gym or type a name"
                  className="flex-1 bg-transparent py-2 text-sm outline-none min-w-0"
                />
                {nameLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              {nameOpen && nameSuggestions.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
                  {nameSuggestions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickNameSuggestion(s);
                        }}
                        className="flex w-full items-start gap-2 px-4 py-2.5 text-left text-sm hover:bg-secondary"
                      >
                        <Search className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{s.primary}</span>
                          {s.secondary && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {s.secondary}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </label>

          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Primary category</span>
            <div className="flex flex-wrap gap-1.5">
              {ORG_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => patch({ category: value.category === c ? "" : c })}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    value.category === c
                      ? "bg-lime/15 text-lime border border-lime/40"
                      : "border border-border text-muted-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">City</span>
            <LocationAutocomplete
              value={value.city}
              onChange={(v) => patch({ city: v })}
              mode="city"
              placeholder="City, region"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Address</span>
            <LocationAutocomplete
              value={value.address}
              onChange={(v) => patch({ address: v })}
              onPick={(full, placeId, geo) =>
                patch({
                  address: full,
                  placeId,
                  geo: geo ? { lat: geo.lat, lng: geo.lng } : null,
                })
              }
              placeholder="Street address"
            />
          </label>
          {!value.geo && (
            <p className="flex items-start gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
              {value.address
                ? "Pick your address from the suggestions to pin it on the map — that's how players find and get directions to you."
                : "Add your street address to pin the facility on the map."}
            </p>
          )}
          {value.geo && value.address && (
            <div className="overflow-hidden rounded-xl border border-border">
              <VenueMapPreview
                address={value.address}
                lat={value.geo.lat}
                lng={value.geo.lng}
                placeId={value.placeId || undefined}
              />
            </div>
          )}
        </Section>

        <Section id="org-hours" title="Hours & status">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs">
            <span className="font-semibold text-muted-foreground">Shows to visitors as</span>
            <span
              className={`rounded-full px-2 py-0.5 font-bold ${
                openNow.status === "open"
                  ? openNow.closingSoon
                    ? "bg-amber-500/15 text-amber-500"
                    : "bg-lime/15 text-lime"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {openNow.status === "open"
                ? "Open now"
                : openNow.status === "closed"
                  ? "Closed"
                  : "Hours not set"}
            </span>
            {openNow.status !== "unknown" && (
              <span className="text-muted-foreground">
                {openNow.label.replace(/^(Open|Closed) · /, "")}
              </span>
            )}
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Timezone</span>
            <input
              value={value.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
              list="org-timezones"
              placeholder="America/New_York"
              className={inputCls}
            />
            <datalist id="org-timezones">
              {timezones.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>
          <p className="text-[11px] text-muted-foreground">
            Pick a quick preset or set each day on its own — different open and close times per day,
            closed, or open 24 hours. Open/closed updates live from these hours.
          </p>
          <HoursEditor value={value.hours} onChange={(h) => patch({ hours: h })} />
        </Section>

        <Section id="org-photos" title="Photos">
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2">Logo</div>
            <ImageUploader
              kind="avatar"
              bucket="org-avatars"
              pathPrefix={userId}
              value={value.avatarUrl}
              onChange={(url) => patch({ avatarUrl: url })}
              onClear={() => patch({ avatarUrl: "" })}
            />
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2">Cover image</div>
            <ImageUploader
              kind="cover"
              bucket="org-covers"
              pathPrefix={userId}
              value={value.coverUrl}
              onChange={(url) => patch({ coverUrl: url })}
              onClear={() => patch({ coverUrl: "" })}
            />
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2">Gallery</div>
            <PhotoGalleryEditor
              value={value.photos}
              onChange={(p) => patch({ photos: p })}
              pathPrefix={userId}
            />
          </div>
        </Section>

        <Section id="org-amenities" title="Courts & amenities">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
            <div>
              <div className="text-sm font-semibold">Number of courts</div>
              <div className="text-[11px] text-muted-foreground">
                How many courts or fields players can use at once.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Fewer courts"
                disabled={!courtCount}
                onClick={() =>
                  patch({ amenities: withCourtCount(value.amenities, (courtCount ?? 0) - 1) })
                }
                className="grid h-8 w-8 place-items-center rounded-full border border-border disabled:opacity-40"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-8 text-center text-sm font-bold tabular-nums">
                {courtCount ?? 0}
              </span>
              <button
                type="button"
                aria-label="More courts"
                disabled={(courtCount ?? 0) >= MAX_COURT_COUNT}
                onClick={() =>
                  patch({ amenities: withCourtCount(value.amenities, (courtCount ?? 0) + 1) })
                }
                className="grid h-8 w-8 place-items-center rounded-full border border-border disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {ORG_AMENITY_GROUPS.map((group) => (
            <div key={group.id} className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground">{group.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map((a) => {
                  const on = value.amenities.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        patch({
                          amenities: on
                            ? value.amenities.filter((x) => x !== a)
                            : [...value.amenities, a],
                        })
                      }
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        on
                          ? "bg-lime/15 text-lime border border-lime/40"
                          : "border border-border text-muted-foreground"
                      }`}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Section>

        <Section id="org-contact" title="Contact">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Phone</span>
            <input
              value={value.phone}
              onChange={(e) => patch({ phone: e.target.value })}
              inputMode="tel"
              placeholder="(555) 123-4567"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Public email</span>
            <input
              value={value.email}
              onChange={(e) => patch({ email: e.target.value })}
              inputMode="email"
              placeholder="hello@yourgym.com"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Website</span>
            <input
              value={value.website}
              onChange={(e) => patch({ website: e.target.value })}
              placeholder="example.com"
              className={inputCls}
            />
          </label>
        </Section>

        <Section id="org-about" title="About">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Handle</span>
            <div className="flex items-center gap-1 rounded-xl border border-border bg-background px-3">
              <span className="text-sm text-muted-foreground">@</span>
              <input
                value={value.handle}
                onChange={(e) => {
                  handleAutoRef.current = false;
                  patch({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") });
                }}
                placeholder="peakgym"
                className="flex-1 bg-transparent py-2 text-sm outline-none"
              />
            </div>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">Description</span>
            <textarea
              value={value.bio}
              onChange={(e) => patch({ bio: e.target.value })}
              rows={4}
              placeholder="What makes this gym worth the trip? Programs, courts, coaching, community."
              className={inputCls}
            />
          </label>
        </Section>

        {err && (
          <div className="rounded-xl border border-coral/40 bg-coral/10 px-3 py-2 text-xs text-coral">
            {err}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              setTouched(true);
              const e = validateOrgForm(value);
              if (e) {
                toast.error(e);
                return;
              }
              onSubmit();
            }}
            className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime disabled:opacity-60"
          >
            {submitting ? "Saving…" : submitLabel}
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-full border border-coral/40 bg-coral/10 px-4 py-3 text-xs font-bold text-coral"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <aside className="mt-6 space-y-2 lg:sticky lg:top-4 lg:mt-0">
        <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Live preview
        </div>
        {preview}
      </aside>
    </div>
  );
}
