import { useEffect, useState } from "react";
import { FileText, Download, ImageIcon } from "lucide-react";
import { getAttachmentUrl } from "@/lib/messages";

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
    getAttachmentUrl(path).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [path]);

  const isImage = (type ?? "").startsWith("image/");
  const isVideo = (type ?? "").startsWith("video/");
  const label = name ?? path.split("/").pop() ?? "Attachment";
  const sizeKb = typeof size === "number" ? `${(size / 1024).toFixed(size > 1024 * 1024 ? 1 : 0)} ${size > 1024 * 1024 ? "MB" : "KB"}` : "";

  if (isImage) {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt={label} className="max-h-64 max-w-full rounded-xl object-cover" />
      </a>
    ) : (
      <div className="grid h-32 w-48 place-items-center rounded-xl bg-black/10">
        <ImageIcon className="h-6 w-6 opacity-50" />
      </div>
    );
  }

  if (isVideo && url) {
    return <video src={url} controls className="max-h-64 max-w-full rounded-xl" />;
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
