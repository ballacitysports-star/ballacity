import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * YouTube-style "About" sheet. The channel header keeps only a one-line
 * description; everything else (full bio, links, stats, badges) lives here.
 */
export function ProfileAboutSheet({
  open,
  onOpenChange,
  title = "About",
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-2xl border-border bg-background"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">{title}</SheetTitle>
        </SheetHeader>
        <div className="space-y-5 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** A labelled block inside the About sheet. */
export function AboutBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 section-eyebrow text-muted-foreground">{label}</h3>
      <div className="text-sm text-foreground/90">{children}</div>
    </section>
  );
}

/** Three-up numeric stat strip used inside the About sheet. */
export function AboutStats({ items }: { items: { k: React.ReactNode; v: string }[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((s) => (
        <div key={s.v} className="rounded-xl border border-border bg-surface p-2.5 text-center">
          <div className="text-sm font-bold">{s.k}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {s.v}
          </div>
        </div>
      ))}
    </div>
  );
}
