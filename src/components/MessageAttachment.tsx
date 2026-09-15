import { useEffect, useState } from "react";
import { FileText, Download, ImageIcon } from "lucide-react";
import { getAttachmentUrl } from "@/lib/messages";
import { ResponsiveImage } from "@/components/ResponsiveImage";

type Props = {
  path: string;
  type: string | null | undefined;
  name: string | null | undefined;
  size?: number | null;
  mine: boolean;
};

export function MessageAttachment({ path, type, name, size, mine }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getAttachmentUrl(path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const isImage = (type ?? "").startsWith("image/");
  const isVideo = (type ?? "").startsWith("video/");
  const label = name ?? path.split("/").pop() ?? "Attachment";
  const sizeKb =
    typeof size === "number"
      ? `${(size / 1024).toFixed(size > 1024 * 1024 ? 1 : 0)} ${size > 1024 * 1024 ? "MB" : "KB"}`
      : "";

  if (isImage) {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <ResponsiveImage
          src={url}
          alt={label}
          widths={[320, 480, 640]}
          sizes="(min-width: 640px) 320px, 70vw"
          baseWidth={480}
          className="max-h-64 max-w-full rounded-xl object-cover"
        />
      </a>
    ) : (
      <div className="grid h-32 w-48 place-items-center rounded-xl bg-black/10">
        <ImageIcon className="h-6 w-6 opacity-50" />
      </div>
    );
  }

  if (isVideo && url) {
    // playsInline keeps the clip in the conversation on iPhone instead of
    // hijacking the screen with the fullscreen player; metadata-only preload
    // keeps a long thread from downloading every attachment at once.
    return (
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        className="max-h-64 max-w-full rounded-xl bg-black"
      />
    );
  }

  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${mine ? "bg-black/15" : "bg-background border border-border"}`}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate font-medium">{label}</span>
      {sizeKb && <span className="opacity-60">{sizeKb}</span>}
      <Download className="h-3.5 w-3.5 opacity-70" />
    </a>
  );
}
