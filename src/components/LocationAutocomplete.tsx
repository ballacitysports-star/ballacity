import { useEffect, useRef, useState } from "react";
import { Loader2, LocateFixed, MapPin } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { reverseGeocode } from "@/lib/geocode.functions";
import { autocompletePlaces, getPlaceDetails, type PlaceSuggestion } from "@/lib/places.functions";
import { toast } from "sonner";

export type PickedPlaceGeo = { lat: number; lng: number; formattedAddress?: string };

function randomToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export function LocationAutocomplete({
  value,
  onChange,
  placeholder = "Court, park or venue",
  mode = "place",
  showCurrentButton = true,
  onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** "place" returns full venue address; "city" returns just city, region */
  mode?: "place" | "city";
  showCurrentButton?: boolean;
  onPick?: (v: string, placeId: string, geo?: PickedPlaceGeo) => void;
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const reverse = useServerFn(reverseGeocode);
  const autocomplete = useServerFn(autocompletePlaces);
  const placeDetails = useServerFn(getPlaceDetails);
  const sessionTokenRef = useRef<string>(randomToken());
  const timerRef = useRef<number | null>(null);
  const biasRef = useRef<{ lat: number; lng: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const reqIdRef = useRef(0);

  // Bias autocomplete results to the user's current location when available.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        biasRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 },
    );
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  const queryAutocomplete = async (input: string) => {
    if (!input.trim() || input.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      setSearchError(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    try {
      const { suggestions: results } = await autocomplete({
        data: {
          input,
          lat: biasRef.current?.lat ?? null,
          lng: biasRef.current?.lng ?? null,
          sessionToken: sessionTokenRef.current,
        },
      });
      if (reqId !== reqIdRef.current) return;
      setSuggestions(results);
      setOpen(results.length > 0);
      setSearchError(
        results.length === 0 ? "No matches — keep typing or enter the address manually" : null,
      );
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      console.error("[LocationAutocomplete] autocomplete failed:", err);
      setSuggestions([]);
      setOpen(false);
      setSearchError("Couldn't load suggestions — you can still type the address manually");
    }
  };

  const handleChange = (v: string) => {
    onChange(v);
    setSearchError(null);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => queryAutocomplete(v), 250);
  };

  const pick = (s: PlaceSuggestion) => {
    const full = s.secondary ? `${s.primary}, ${s.secondary}` : s.primary;
    onChange(full);
    // Fire optimistic pick without geo, then enrich with lat/lng once resolved.
    onPick?.(full, s.id);
    setOpen(false);
    setSuggestions([]);
    const tokenAtPick = sessionTokenRef.current;
    // Rotate session token after a selection (Places billing convention).
    sessionTokenRef.current = randomToken();
    placeDetails({ data: { placeId: s.id, sessionToken: tokenAtPick } })
      .then((d) => {
        const resolved = d.formattedAddress || full;
        // Only replace the input text if the user hasn't kept editing.
        if (d.formattedAddress && d.formattedAddress !== full) onChange(resolved);
        onPick?.(resolved, s.id, { lat: d.lat, lng: d.lng, formattedAddress: d.formattedAddress });
      })
      .catch((err) => {
        console.error("[LocationAutocomplete] place details failed:", err);
      });
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not available");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { formatted, city } = await reverse({
            data: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          const next = mode === "city" ? city || formatted : formatted || city;
          if (next) {
            onChange(next);
            // Report the device coordinates so callers can store real geo.
            onPick?.(next, "", {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              formattedAddress: next,
            });
            toast.success("Location set");
          } else {
            toast.error("No address found");
          }
        } catch {
          toast.error("Couldn't resolve location");
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === 1 ? "Location permission denied" : "Couldn't get location");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-3">
        <MapPin className="h-4 w-4 text-coral" />
        <input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
        />
        {showCurrentButton && (
          <button
            type="button"
            onClick={useCurrentLocation}
            disabled={locating}
            title="Use current location"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-lime hover:text-lime disabled:opacity-60"
          >
            {locating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LocateFixed className="h-3.5 w-3.5" />
            )}
            <span>Current</span>
          </button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                className="flex w-full items-start gap-2 px-4 py-2.5 text-left text-sm hover:bg-secondary"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-coral" />
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
      {searchError && (
        <p role="status" className="mt-1 px-1 text-[11px] text-muted-foreground">
          {searchError}
        </p>
      )}
    </div>
  );
}
