import { useRef, useState } from "react";
import { Upload, Check, Loader2, X } from "lucide-react";
import { imageFor, type Sport } from "@/lib/sample-data";
import { uploadTeamCover, TeamCoverUploadError } from "@/lib/team-covers";

type Props = {
  cover: string;
  onCoverChange: (url: string) => void;
  /** Whether the current cover was an uploaded (custom) photo. */
  isCustom: boolean;
  onCustomChange: (isCustom: boolean) => void;
  fallback: string;
  presets?: Sport[];
};

const DEFAULT_PRESETS: Sport[] = [
  "Basketball",
  "Soccer",
  "Tennis",
  "Volleyball",
  "Pickleball",
  "Running",
];

export function TeamCoverUploader({
  cover,
  onCoverChange,
  isCustom,
  onCustomChange,
  fallback,
  presets = DEFAULT_PRESETS,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    setPercent(0);
    try {
      const { url } = await uploadTeamCover(file, (p) => setPercent(p.percent));
      onCoverChange(url);
      onCustomChange(true);
    } catch (e) {
      const message =
        e instanceof TeamCoverUploadError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Upload failed.";
      setError(message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-surface p-3">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-background">
          <img src={cover} alt="Team cover preview" className="h-full w-full object-cover" />
          {isCustom && !uploading && (
            <span className="absolute top-2 left-2 rounded-full bg-lime/90 px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
              Uploaded
            </span>
          )}
          {uploading && (
            <div className="absolute inset-0 bg-background/70 backdrop-blur-sm grid place-items-center">
              <div className="flex flex-col items-center gap-2 text-center px-4">
                <Loader2 className="h-6 w-6 animate-spin text-lime" />
                <div className="text-xs font-bold">Uploading… {percent}%</div>
                <div className="h-1.5 w-40 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-lime-gradient transition-[width] duration-150"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <label
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${
              uploading
                ? "border-border bg-surface text-muted-foreground cursor-not-allowed"
                : "border-lime bg-lime/10 text-lime cursor-pointer hover:bg-lime/15"
            }`}
          >
            <Upload className="h-4 w-4" />
            {isCustom ? "Change photo" : "Upload photo"}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              disabled={uploading}
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {isCustom && !uploading && (
            <button
              type="button"
              onClick={() => {
                onCoverChange(fallback);
                onCustomChange(false);
                setError(null);
                setPercent(0);
              }}
              className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-bold text-muted-foreground inline-flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-coral">{error}</p>}
        <p className="mt-2 text-[10px] text-muted-foreground">
          JPG or PNG, up to 4 MB. Wide crops look best.
        </p>
      </div>

      <div>
        <div className="mb-2 micro-label text-muted-foreground">
          Or pick a preset
        </div>
        <div className="grid grid-cols-3 gap-2">
          {presets.map((s) => {
            const src = imageFor(s);
            const active = cover === src;
            return (
              <button
                key={s}
                type="button"
                disabled={uploading}
                onClick={() => {
                  onCoverChange(src);
                  onCustomChange(false);
                  setError(null);
                }}
                className={`relative aspect-video overflow-hidden rounded-xl border-2 transition-all ${
                  active ? "border-lime" : "border-transparent opacity-70 hover:opacity-100"
                } ${uploading ? "pointer-events-none opacity-40" : ""}`}
              >
                <img src={src} alt="" className="h-full w-full object-cover" />
                {active && (
                  <span className="absolute inset-0 bg-lime/20 grid place-items-center">
                    <Check className="h-5 w-5 text-lime" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
