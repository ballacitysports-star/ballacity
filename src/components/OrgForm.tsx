import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { VenueMapPreview } from "@/components/VenueMapPreview";
import { ImageUploader } from "@/components/ImageUploader";
import {
  autocompletePlaces,
  getPlaceDetails,
  type PlaceSuggestion,
} from "@/lib/places.functions";

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
  };
}

const HANDLE_RE = /^[a-z0-9_-]{3,40}$/;

export function validateOrgForm(v: OrgFormValue): string | null {
  if (v.name.trim().length < 2) return "Name is too short.";
  if (!HANDLE_RE.test(v.handle.trim().toLowerCase()))
    return "Handle must be 3–40 chars: a–z, 0–9, - or _.";
  if (v.website && !/^https?:\/\//i.test(v.website)) return "Website must start with http(s)://";
  return null;
}

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
    patch({ name: v });
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => queryNameSuggestions(v), 250);
  };

  const pickNameSuggestion = (s: PlaceSuggestion) => {
    const fallbackAddress = s.secondary ? `${s.primary}, ${s.secondary}` : s.primary;
    patch({
      name: s.primary,
      address: fallbackAddress,
      placeId: s.id,
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
        });
      })
      .catch((e) => {
        console.error("[OrgForm] place details failed:", e);
      });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Identity
        </h2>
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
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Handle</span>
          <div className="flex items-center gap-1 rounded-xl border border-border bg-background px-3">
            <span className="text-sm text-muted-foreground">@</span>
            <input
              value={value.handle}
              onChange={(e) =>
                patch({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })
              }
              placeholder="peakgym"
              className="flex-1 bg-transparent py-2 text-sm outline-none"
            />
          </div>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Bio</span>
          <textarea
            value={value.bio}
            onChange={(e) => patch({ bio: e.target.value })}
            rows={3}
            placeholder="A short description of the gym or organization."
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime/60"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Website</span>
          <input
            value={value.website}
            onChange={(e) => patch({ website: e.target.value })}
            placeholder="https://example.com"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime/60"
          />
        </label>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Location
        </h2>
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
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 space-y-4">
        <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Branding
        </h2>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">Logo / Avatar</div>
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
      </section>

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
  );
}
