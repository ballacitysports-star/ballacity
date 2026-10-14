import { useState, type ReactNode } from "react";
import { Check, Copy, Facebook, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  buildCaption,
  platformShareUrl,
  type ShareContent,
  type SharePlatform,
} from "@/lib/social-share";

const PLATFORMS: { id: SharePlatform; label: string; icon: ReactNode }[] = [
  {
    id: "x",
    label: "X",
    icon: <span className="text-sm font-black leading-none">𝕏</span>,
  },
  { id: "facebook", label: "Facebook", icon: <Facebook className="h-4 w-4" /> },
  { id: "whatsapp", label: "WhatsApp", icon: <MessageCircle className="h-4 w-4" /> },
];

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareSheet({
  content,
  open,
  onOpenChange,
}: {
  content: ShareContent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const canNative = typeof navigator !== "undefined" && !!navigator.share;

  const copyAll = async () => {
    const ok = await copy(buildCaption(content, { withUrl: true }));
    if (!ok) return toast.error("Couldn't copy");
    setCopied(true);
    toast.success("Caption and link copied", {
      description: "Paste it into Instagram, TikTok or anywhere else.",
    });
    setTimeout(() => setCopied(false), 1600);
  };

  const native = async () => {
    try {
      await navigator.share({
        title: content.title,
        text: buildCaption(content),
        url: content.url,
      });
      onOpenChange(false);
    } catch {
      /* cancelled */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription className="line-clamp-2">{content.title}</DialogDescription>
        </DialogHeader>
        <pre className="whitespace-pre-wrap rounded-xl bg-secondary p-3 text-xs">
          {buildCaption(content)}
        </pre>
        <div className="grid grid-cols-3 gap-2">
          {PLATFORMS.map((p) => (
            <Button key={p.id} asChild variant="outline" className="h-auto flex-col gap-1 py-3">
              <a href={platformShareUrl(p.id, content)} target="_blank" rel="noopener noreferrer">
                {p.icon}
                <span className="text-xs">{p.label}</span>
              </a>
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={copyAll}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy caption
          </Button>
          {canNative && (
            <Button className="flex-1" onClick={native}>
              <Share2 className="h-4 w-4" /> More…
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
