import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

/**
 * A collapsible subsection used inside the About card on a player profile.
 * Expanding/collapsing happens inline — no navigation, no sheet.
 */
export function ExpandableAboutSection({
  label,
  count,
  badge,
  defaultOpen = false,
  children,
}: {
  label: string;
  count?: number | null;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-xl px-1 py-2 text-left transition-colors hover:bg-secondary/60"
        >
          <span className="flex items-center gap-2">
            <span className="section-eyebrow text-muted-foreground">{label}</span>
            {count != null && count > 0 && (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                {count}
              </span>
            )}
            {badge}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="pb-2 pl-1 pr-1 pt-0.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
