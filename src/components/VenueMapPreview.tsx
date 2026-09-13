import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, MapPin } from "lucide-react";
import { loadGoogleMaps, GMAPS_DARK_STYLE } from "@/lib/gmaps-loader";

/**
 * Small interactive map showing a single pinned venue location + nearby context.
 * Rendered under each verified venue row in the create/edit wizard so trainers
 * can visually confirm the address resolved to the right place before saving.
 */
export function VenueMapPreview({
  address,
  lat,
  lng,
  placeId,
}: {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Init once
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google?.maps) return;
        mapRef.current = new window.google.maps.Map(containerRef.current, {
          center: { lat, lng },
          zoom: 15,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
          styles: GMAPS_DARK_STYLE,
        });
        markerRef.current = new window.google.maps.Marker({
          position: { lat, lng },
          map: mapRef.current,
          title: address,
        });
        setReady(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Map failed to load"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-center when the pin moves (address swapped in place)
  useEffect(() => {
    if (!ready || !mapRef.current || !markerRef.current) return;
    const pos = { lat, lng };
    mapRef.current.setCenter(pos);
    markerRef.current.setPosition(pos);
    markerRef.current.setTitle(address);
  }, [lat, lng, address, ready]);

  const externalHref = placeId
    ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border/60 bg-surface">
      <div className="relative h-40 w-full bg-muted/30">
        <div
          ref={containerRef}
          className="absolute inset-0"
          aria-label={`Map preview for ${address}`}
        />
        {!ready && !error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-muted-foreground">
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{address}</span>
        </span>
        <a
          href={externalHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-0.5 text-primary hover:underline"
        >
          Open <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
