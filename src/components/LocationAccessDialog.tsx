import { useState } from "react";
import { MapPin, Navigation } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { useUserLocation } from "@/lib/geo";

/**
 * Shown when the browser won't give us a position (blocked, embedded preview,
 * unsupported). It explains why, lets the user retry the native prompt, and —
 * crucially — offers a manual place so distances work regardless.
 */
export function LocationAccessDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { status, error, request, setManual } = useUserLocation();
  const [text, setText] = useState("");

  const retry = async () => {
    const snap = await request();
    if (snap.coords && snap.status === "granted") {
      toast.success("Location enabled");
      onOpenChange(false);
    } else {
      toast.error("Your browser didn't share a location — set it manually below.");
    }
  };

  const why =
    error === "denied"
      ? "Location is blocked for this site. Allow it in your browser's site settings (tap the lock or ⓘ icon in the address bar), then retry."
      : error === "blocked"
        ? "This view can't request your device location. Open the app in its own browser tab, or set your location manually."
        : error === "timeout"
          ? "Your device took too long to return a position. Retry, or set your location manually."
          : error === "unavailable"
            ? "Your device couldn't determine a position right now. Set your location manually instead."
            : "Share your location to see how far away each game is.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set your location</DialogTitle>
          <DialogDescription>{why}</DialogDescription>
        </DialogHeader>

        <Button
          onClick={retry}
          disabled={status === "prompting"}
          className="rounded-full bg-lime-gradient text-primary-foreground"
        >
          <Navigation className="mr-1 h-4 w-4" />
          {status === "prompting" ? "Locating…" : "Use my current location"}
        </Button>

        <div className="mt-1 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Or pick a place
          </p>
          <LocationAutocomplete
            value={text}
            onChange={setText}
            mode="city"
            showCurrentButton={false}
            placeholder="City, neighborhood or venue"
            onPick={(v, _placeId, geo) => {
              setText(v);
              if (geo?.lat != null && geo?.lng != null) {
                setManual({ lat: geo.lat, lng: geo.lng }, geo.formattedAddress ?? v);
                toast.success(`Measuring distances from ${v}`);
                onOpenChange(false);
              } else {
                toast.error("Couldn't map that place — try another.");
              }
            }}
          />
          <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <span>Used only to measure distances on your device. Change it any time.</span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
