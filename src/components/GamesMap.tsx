import { type FormEvent, useEffect, useRef, useState } from "react";
import { LocateFixed, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { geocodeAddress } from "@/lib/geocode.functions";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";

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

// Dark mode map styling to match app theme
const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1a1f2e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1f2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a93a6" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a3142" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1a1f2e" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f1420" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
];

export type MapPinItem = {
  id: string;
  emoji: string;
  /** pseudo coord 0-100 from sample data (lat = y, lng = x) */
  lat: number;
  lng: number;
  urgent?: boolean;
};

export function GamesMap({
  pins,
  activeId,
  onSelect,
  defaultLocation,
  onVisibleChange,
}: {
  pins: MapPinItem[];
  activeId: string;
  onSelect: (id: string) => void;
  defaultLocation?: string | null;
  onVisibleChange?: (ids: string[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const userCircleRef = useRef<any>(null);
  const searchMarkerRef = useRef<any>(null);
  const pinMarkersRef = useRef<Map<string, any>>(new Map());
  const userPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const pinCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const manualLocationRef = useRef(false);
  const defaultLocationRef = useRef("");
  const [ready, setReady] = useState(false);
  const [manualLocation, setManualLocation] = useState(defaultLocation?.trim() ?? "");
  const [resolvingLocation, setResolvingLocation] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [areaDirty, setAreaDirty] = useState(false);
  const geocode = useServerFn(geocodeAddress);

  const computeVisibleIds = (): string[] => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return pins.map((p) => p.id);
    const bounds = map.getBounds();
    if (!bounds) return pins.map((p) => p.id);
    const ids: string[] = [];
    pinMarkersRef.current.forEach((marker, id) => {
      const pos = marker.getPosition?.();
      if (pos && bounds.contains(pos)) ids.push(id);
    });
    return ids;
  };

  const searchThisArea = () => {
    onVisibleChange?.(computeVisibleIds());
    setAreaDirty(false);
  };

  // Convert a 0-100 pseudo coord to a real lat/lng offset around user.
  // Spread games across ~6km box.
  const toLatLng = (px: number, py: number, center: { lat: number; lng: number }) => {
    const dLat = ((50 - py) / 100) * 0.06;
    const dLng = ((px - 50) / 100) * 0.08;
    return { lat: center.lat + dLat, lng: center.lng + dLng };
  };

  // Initialize map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(async () => {
        if (cancelled || !containerRef.current) return;
        const { Map } = await window.google.maps.importLibrary("maps");
        mapRef.current = new Map(containerRef.current, {
          center: { lat: 40.7281, lng: -73.9842 }, // NYC fallback
          zoom: 14,
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          styles: DARK_STYLE,
        });
        mapRef.current.addListener("dragend", () => setAreaDirty(true));
        mapRef.current.addListener("zoom_changed", () => setAreaDirty(true));
        setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the map search field synced to profile/default location, even after manual map edits.
  useEffect(() => {
    if (!ready) return;
    const nextLocation = defaultLocation?.trim() ?? "";
    const defaultChanged = nextLocation !== defaultLocationRef.current;
    defaultLocationRef.current = nextLocation;

    if (!nextLocation) {
      if (!manualLocationRef.current) setManualLocation("");
      return;
    }

    if (defaultChanged) {
      manualLocationRef.current = false;
      setManualLocation(nextLocation);
    } else {
      setManualLocation((current) => current.trim() ? current : nextLocation);
    }

    let cancelled = false;
    geocode({ data: { address: nextLocation } })
      .then((result) => {
        if (cancelled || !mapRef.current) return;
        // Preserve a live GPS/manual center unless the profile/default location just changed.
        if (!defaultChanged && (userPosRef.current || manualLocationRef.current)) return;
        const center = { lat: result.lat, lng: result.lng };
        pinCenterRef.current = center;
        mapRef.current.panTo(center);
        mapRef.current.setZoom(13);
        repositionPins();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, defaultLocation]);

  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const applyPosition = (pos: GeolocationPosition, recenter: boolean) => {
    const center = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const firstFix = !userPosRef.current;
    userPosRef.current = center;
    if (!mapRef.current || !window.google?.maps) return;
    if (!userMarkerRef.current) {
      userMarkerRef.current = new window.google.maps.Marker({
        position: center,
        map: mapRef.current,
        zIndex: 999,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#a3e635",
          fillOpacity: 1,
          strokeColor: "#0f1420",
          strokeWeight: 3,
        },
      });
      userCircleRef.current = new window.google.maps.Circle({
        map: mapRef.current,
        center,
        radius: pos.coords.accuracy || 50,
        fillColor: "#a3e635",
        fillOpacity: 0.12,
        strokeColor: "#a3e635",
        strokeOpacity: 0.35,
        strokeWeight: 1,
      });
    } else {
      userMarkerRef.current.setPosition(center);
      userCircleRef.current.setCenter(center);
      userCircleRef.current.setRadius(pos.coords.accuracy || 50);
    }
    if (recenter) {
      manualLocationRef.current = false;
      searchMarkerRef.current?.setMap(null);
      searchMarkerRef.current = null;
    }
    if (!manualLocationRef.current) {
      pinCenterRef.current = center;
      repositionPins();
    }
    if (firstFix || recenter) {
      mapRef.current.panTo(center);
      mapRef.current.setZoom(15);
    }
  };

  const describeGeoError = (err: GeolocationPositionError) => {
    if (err.code === 1) return "Location permission denied";
    if (err.code === 2) return "Location unavailable";
    if (err.code === 3) return "Location request timed out";
    return "Couldn't get location";
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setGeoError(null);
        applyPosition(pos, true);
        toast.success("Centered on your location");
      },
      (err) => {
        setLocating(false);
        const msg = describeGeoError(err);
        setGeoError(msg);
        toast.error(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const performGeocode = async (query: string) => {
    const q = query.trim();
    if (q.length < 2) return;
    setResolvingLocation(true);
    setManualError(null);
    try {
      const result = await geocode({ data: { address: q } });
      const center = { lat: result.lat, lng: result.lng };
      manualLocationRef.current = true;
      pinCenterRef.current = center;
      setGeoError(null);
      setManualLocation(result.formatted || q);
      if (mapRef.current && window.google?.maps) {
        if (!searchMarkerRef.current) {
          searchMarkerRef.current = new window.google.maps.Marker({
            position: center,
            map: mapRef.current,
            zIndex: 998,
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: "#ff6b6b",
              fillOpacity: 1,
              strokeColor: "#0f1420",
              strokeWeight: 3,
            },
          });
        } else {
          searchMarkerRef.current.setPosition(center);
          searchMarkerRef.current.setMap(mapRef.current);
        }
        mapRef.current.panTo(center);
        mapRef.current.setZoom(14);
      }
      repositionPins();
      toast.success("Map location changed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't find that location";
      setManualError(message);
      toast.error(message);
    } finally {
      setResolvingLocation(false);
    }
  };

  const changeMapLocation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void performGeocode(manualLocation);
  };



  const repositionPins = () => {
    const center = pinCenterRef.current || userPosRef.current || { lat: 40.7281, lng: -73.9842 };
    pins.forEach((p) => {
      const m = pinMarkersRef.current.get(p.id);
      if (m) m.setPosition(toLatLng(p.lng, p.lat, center));
    });
  };

  // Build pin markers
  useEffect(() => {
    if (!ready || !mapRef.current || !window.google?.maps) return;
    const existing = pinMarkersRef.current;
    const center = userPosRef.current || { lat: 40.7281, lng: -73.9842 };

    pins.forEach((p) => {
      if (existing.has(p.id)) return;
      const marker = new window.google.maps.Marker({
        position: toLatLng(p.lng, p.lat, center),
        map: mapRef.current,
        icon: makePinIcon(p.emoji, p.id === activeId, !!p.urgent),
      });
      marker.addListener("click", () => onSelect(p.id));
      existing.set(p.id, marker);
    });

    // remove stale
    Array.from(existing.keys()).forEach((id) => {
      if (!pins.find((p) => p.id === id)) {
        existing.get(id)?.setMap(null);
        existing.delete(id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pins]);

  // Update active styling
  useEffect(() => {
    if (!ready) return;
    pins.forEach((p) => {
      const m = pinMarkersRef.current.get(p.id);
      if (m) m.setIcon(makePinIcon(p.emoji, p.id === activeId, !!p.urgent));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, ready]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      <button
        type="button"
        onClick={locateMe}
        className="absolute bottom-48 right-4 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface/95 backdrop-blur-xl text-lime shadow-xl active:scale-95 transition"
        title="Center on my location"
      >
        {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
      </button>
      <form onSubmit={changeMapLocation} className="absolute left-4 right-4 top-20 z-30">
        <div className="flex items-stretch gap-2">
          <div className="flex-1 min-w-0 [&>div>div]:bg-surface/95 [&>div>div]:backdrop-blur-xl [&>div>div]:shadow-xl">
            <LocationAutocomplete
              value={manualLocation}
              onChange={(v) => { setManualLocation(v); setManualError(null); }}
              onPick={(v) => { void performGeocode(v); }}
              placeholder="Change map location"
              showCurrentButton={false}
            />
          </div>
          <button
            type="submit"
            disabled={resolvingLocation || manualLocation.trim().length < 2}
            className="inline-flex items-center justify-center rounded-2xl bg-lime px-4 text-xs font-bold text-primary-foreground shadow-xl disabled:opacity-50"
          >
            {resolvingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}
          </button>
        </div>
        {manualError && <p className="mt-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200 backdrop-blur-xl">{manualError}</p>}
      </form>
    </>
  );
}

function makePinIcon(emoji: string, active: boolean, urgent: boolean) {
  const bg = active ? "#a3e635" : "#1a1f2e";
  const border = active ? "#a3e635" : "#3a4256";
  const dot = urgent ? `<circle cx="36" cy="6" r="4" fill="#ff5a5f" stroke="#0f1420" stroke-width="1.5"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" fill="${bg}" stroke="${border}" stroke-width="2"/><text x="22" y="28" text-anchor="middle" font-size="18">${emoji}</text>${dot}</svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(44, 44),
    anchor: new window.google.maps.Point(22, 22),
  };
}
