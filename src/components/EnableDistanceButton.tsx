import { useState } from "react";
import { Navigation } from "lucide-react";
import { useUserLocation } from "@/lib/geo";
import { LocationAccessDialog } from "@/components/LocationAccessDialog";

/**
 * Shown while we don't know where the viewer is. Tapping asks the browser for a
 * position and falls back to manual entry, so the tap always does something.
 */
export function EnableDistanceButton({ className = "" }: { className?: string }) {
  const { coords, status, error, request } = useUserLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  if (coords) return null;

  const onTap = async () => {
    if (status === "denied" || status === "unsupported" || error) {
      setDialogOpen(true);
      return;
    }
    const snap = await request();
    if (!snap.coords || snap.status !== "granted") setDialogOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onTap}
        disabled={status === "prompting"}
        className={`inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime disabled:opacity-60 ${className}`}
      >
        <Navigation className="h-3.5 w-3.5" aria-hidden />
        {status === "prompting" ? "Locating…" : "Show distances"}
      </button>
      <LocationAccessDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
