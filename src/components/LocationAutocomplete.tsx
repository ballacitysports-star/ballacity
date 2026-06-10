import { useEffect, useRef, useState } from "react";
import { Loader2, LocateFixed, MapPin } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { reverseGeocode } from "@/lib/geocode.functions";
import { toast } from "sonner";

declare global {
  interface Window {
    google?: any;
    __gmapsLoading?: Promise<void>;
  }
}

function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (window.__gmapsLoading) return window.__gmapsLoading;

  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
  if (!key) return Promise.reject(new Error("Maps key missing"));

  window.__gmapsLoading = new Promise<void>((resolve, reject) => {
    (window as any).__initGmaps = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&libraries=places&callback=__initGmaps${channel ? `&channel=${channel}` : ""}`;
    s.async = true;
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });
  return window.__gmapsLoading;
}

type Suggestion = { id: string; primary: string; secondary: string };

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
  onPick?: (v: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const reverse = useServerFn(reverseGeocode);
  const sessionRef = useRef<any>(null);
  const placesRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);
  const biasRef = useRef<{ lat: number; lng: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const notifiedMapsErrorRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const fail = () => {
      if (cancelled) return;
      setMapsError("Map search unavailable — you can still type the address manually");
      if (!notifiedMapsErrorRef.current) {
        notifiedMapsErrorRef.current = true;
        toast.error("Map search unavailable", {
          description: "You can still enter the address manually.",
        });
      }
    };
    loadGoogleMaps()
      .then(async () => {
        if (cancelled) return;
        try {
          const places = await window.google.maps.importLibrary("places");
          placesRef.current = places;
          sessionRef.current = new places.AutocompleteSessionToken();
          setMapsError(null);
        } catch {
          fail();
        }
      })
      .catch(fail);
    return () => { cancelled = true; };
  }, []);

  // Continuously track the user's location to bias autocomplete results in real time.
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

  const queryAutocomplete = (input: string) => {
    if (!placesRef.current || !input.trim()) {
      setSuggestions([]);
      return;
    }
    const req: any = {
      input,
      sessionToken: sessionRef.current,
    };
    if (biasRef.current) {
      req.locationBias = {
        circle: {
          center: { lat: biasRef.current.lat, lng: biasRef.current.lng },
          radius: 50000,
        },
      };
      req.origin = { lat: biasRef.current.lat, lng: biasRef.current.lng };
    }
    placesRef.current.AutocompleteSuggestion.fetchAutocompleteSuggestions(req)
      .then(({ suggestions: results }: any) => {
        const mapped: Suggestion[] = (results || [])
          .map((r: any) => r.placePrediction)
          .filter(Boolean)
          .slice(0, 5)
          .map((p: any) => ({
            id: p.placeId,
            primary: p.structuredFormat?.mainText?.text || p.text?.text || "",
            secondary: p.structuredFormat?.secondaryText?.text || "",
          }));
        setSuggestions(mapped);
        setOpen(mapped.length > 0);
        setSearchError(mapped.length === 0 ? "No matches — keep typing or enter the address manually" : null);
      })
      .catch(() => {
        setSuggestions([]);
        setOpen(false);
        setSearchError("Couldn't load suggestions — you can still type the address manually");
      });
  };

  const handleChange = (v: string) => {
    onChange(v);
    setSearchError(null);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => queryAutocomplete(v), 200);
  };

  const pick = (s: Suggestion) => {
    const full = s.secondary ? `${s.primary}, ${s.secondary}` : s.primary;
    onChange(full);
    onPick?.(full);
    setOpen(false);
    setSuggestions([]);
    if (placesRef.current) {
      sessionRef.current = new placesRef.current.AutocompleteSessionToken();
    }
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
            {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
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
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                className="flex w-full items-start gap-2 px-4 py-2.5 text-left text-sm hover:bg-secondary"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-coral" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.primary}</span>
                  {s.secondary && (
                    <span className="block truncate text-xs text-muted-foreground">{s.secondary}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(mapsError || searchError) && (
        <p role="status" className="mt-1 px-1 text-[11px] text-muted-foreground">
          {mapsError ?? searchError}
        </p>
      )}
    </div>
  );
}
