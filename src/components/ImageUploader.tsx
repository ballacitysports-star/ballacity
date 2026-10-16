import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Upload, Loader2, X, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { ImageEditorDialog } from "@/components/ImageEditorDialog";
import { uploadDataUrlToBucket, type ImageBucket } from "@/lib/image-upload";
import { imageFor, type Sport } from "@/lib/sample-data";
import { ResponsiveImage } from "@/components/ResponsiveImage";

type Kind = "avatar" | "cover";

type Props = {
  kind: Kind;
  bucket: ImageBucket;
  /** First path segment — must satisfy the bucket's RLS (auth.uid() or entity id). */
  pathPrefix: string | null | undefined;
  value?: string | null;
  onChange: (url: string) => void;
  onClear?: () => void;
  /** Placeholder shown when there is no value. */
  fallback?: string;
  /** Cover-only quick-pick chips. */
  presets?: Sport[];
  /** Enable AI background removal (avatar only, default true). */
  allowBgRemoval?: boolean;
  disabled?: boolean;
  label?: string;
  /** Team / org logo: square frame, opens with the whole image visible. */
  logo?: boolean;
};

const DEFAULT_PRESETS: Sport[] = [
  "Basketball",
  "Soccer",
  "Tennis",
  "Volleyball",
  "Pickleball",
  "Running",
];

/**
 * Unified avatar / cover uploader that opens {@link ImageEditorDialog} for
 * the full crop → transform → adjust → filter → bg-remove pipeline, then
 * uploads the resulting data URL to the given Supabase Storage bucket.
 */
export function ImageUploader({
  kind,
  bucket,
  pathPrefix,
  value,
  onChange,
  onClear,
  fallback,
  presets,
  allowBgRemoval,
  disabled,
  label,
  logo = false,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const shape = logo ? "square" : kind === "avatar" ? "circle" : "rect";
  const aspect = kind === "avatar" ? 1 : 16 / 9;
  const outputMaxSize = kind === "avatar" ? 512 : 1600;
  const bgRemoval = allowBgRemoval ?? kind === "avatar";
  const preview = value || fallback || "";

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Please choose an image");
      return;
    }
    setFile(f);
    setOpen(true);
  };

  const handleConfirm = async (dataUrl: string) => {
    setOpen(false);
    setFile(null);
    if (!pathPrefix) {
      toast.error("You need to be signed in to upload an image.");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadDataUrlToBucket(bucket, pathPrefix, dataUrl);
      onChange(url);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const isCover = kind === "cover";
  const hasValue = !!value;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-surface p-3">
        <div
          className={
            isCover
              ? "relative aspect-video overflow-hidden rounded-xl bg-background"
              : `relative mx-auto h-28 w-28 overflow-hidden bg-background border border-border/60 ${
                  logo ? "rounded-2xl" : "rounded-full"
                }`
          }
        >
          {preview ? (
            <ResponsiveImage
              src={preview}
              alt={label ?? (isCover ? "Cover preview" : "Avatar preview")}
              aspect={isCover ? 16 / 9 : 1}
              widths={isCover ? [320, 480, 640, 960] : [112, 224, 448]}
              sizes={isCover ? "(min-width: 640px) 420px, 90vw" : "112px"}
              baseWidth={isCover ? 640 : 224}
              className={`h-full w-full ${logo ? "object-contain" : "object-cover"}`}
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted-foreground">
              <ImagePlus className="h-6 w-6" />
            </div>
          )}
          {hasValue && !uploading && (
            <span
              className={`absolute rounded-full bg-lime/90 px-2 py-0.5 text-[10px] font-bold text-primary-foreground ${
                isCover ? "top-2 left-2" : "bottom-0 right-0"
              }`}
            >
              Uploaded
            </span>
          )}
          {uploading && (
            <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs font-bold">
                <Loader2 className="h-4 w-4 animate-spin text-lime" /> Uploading…
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <label
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${
              uploading || disabled
                ? "border-border bg-surface text-muted-foreground cursor-not-allowed"
                : "border-lime bg-lime/10 text-lime cursor-pointer hover:bg-lime/15"
            }`}
          >
            <Upload className="h-4 w-4" />
            {hasValue ? "Change photo" : "Upload photo"}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              disabled={uploading || disabled || open}
              className="hidden"
              onClick={(e) => {
                // Never let a bubbling click from elsewhere (e.g. the crop editor)
                // reopen the OS file picker.
                if (open) e.preventDefault();
                e.stopPropagation();
              }}
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {hasValue && !uploading && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-bold text-muted-foreground inline-flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          JPG, PNG or WEBP · edit, filter{bgRemoval ? ", remove background" : ""} before saving.
        </p>
      </div>

      {isCover && presets && presets.length > 0 && (
        <div>
          <div className="mb-2 micro-label text-muted-foreground">
            Or pick a preset
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(presets.length ? presets : DEFAULT_PRESETS).map((s) => {
              const src = imageFor(s);
              const active = value === src;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={uploading || disabled}
                  onClick={() => onChange(src)}
                  className={`relative aspect-video overflow-hidden rounded-xl border-2 transition-all ${
                    active ? "border-lime" : "border-transparent opacity-70 hover:opacity-100"
                  } ${uploading ? "pointer-events-none opacity-40" : ""}`}
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {typeof document !== "undefined" &&
        createPortal(
          <ImageEditorDialog
            open={open}
            file={file}
            aspect={aspect}
            outputMaxSize={outputMaxSize}
            shape={shape}
            title={isCover ? "Edit cover" : logo ? "Edit logo" : "Edit photo"}
            initialFit={logo || isCover}
            allowBgRemoval={bgRemoval}
            onCancel={() => {
              setOpen(false);
              setFile(null);
            }}
            onPickFile={(f) => pickFile(f)}
            onConfirm={handleConfirm}
          />,
          document.body,
        )}
    </div>
  );
}
