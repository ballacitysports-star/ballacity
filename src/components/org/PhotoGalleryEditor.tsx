import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Loader2, X, ArrowLeft, ArrowRight } from "lucide-react";
import { uploadDataUrlToBucket } from "@/lib/image-upload";
import { ResponsiveImage } from "@/components/ResponsiveImage";

const MAX_PHOTOS = 12;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file"));
    r.readAsDataURL(file);
  });
}

/**
 * Listing photo gallery: upload up to {@link MAX_PHOTOS} images, reorder them,
 * and delete. The first photo acts as the listing hero when no cover is set.
 */
export function PhotoGalleryEditor({
  value,
  onChange,
  pathPrefix,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  pathPrefix: string | null | undefined;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    if (!pathPrefix) {
      toast.error("Sign in before uploading photos.");
      return;
    }
    const room = MAX_PHOTOS - value.length;
    if (room <= 0) {
      toast.error(`Up to ${MAX_PHOTOS} photos.`);
      return;
    }
    setUploading(true);
    try {
      const picked = Array.from(files).slice(0, room);
      const urls: string[] = [];
      for (const f of picked) {
        const dataUrl = await readAsDataUrl(f);
        urls.push(await uploadDataUrlToBucket("org-covers", pathPrefix, dataUrl));
      }
      onChange([...value, ...urls]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {value.map((url, i) => (
          <div
            key={url + i}
            className="group relative overflow-hidden rounded-xl border border-border"
          >
            <ResponsiveImage
              src={url}
              alt={`Gym photo ${i + 1}`}
              aspect={4 / 3}
              widths={[160, 320, 480]}
              sizes="(min-width: 640px) 200px, 33vw"
              baseWidth={320}
              className="h-24 w-full object-cover"
            />
            {i === 0 && (
              <span className="absolute left-1 top-1 rounded-full bg-background/85 px-1.5 py-0.5 text-[10px] font-bold">
                Hero
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-background/80 px-1 py-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                aria-label="Move photo earlier"
                className="p-0.5 text-muted-foreground disabled:opacity-30"
                disabled={i === 0}
              >
                <ArrowLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, k) => k !== i))}
                aria-label="Remove photo"
                className="p-0.5 text-coral"
              >
                <X className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                aria-label="Move photo later"
                className="p-0.5 text-muted-foreground disabled:opacity-30"
                disabled={i === value.length - 1}
              >
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
        {value.length < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="grid h-24 place-items-center rounded-xl border border-dashed border-border text-muted-foreground hover:border-lime/60"
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-[11px] font-semibold">
                <ImagePlus className="h-5 w-5" /> Add photo
              </span>
            )}
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {value.length}/{MAX_PHOTOS} photos. The first photo is used as the listing hero.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
    </div>
  );
}
