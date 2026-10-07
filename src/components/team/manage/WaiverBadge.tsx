import { Check, X } from "lucide-react";

export type Waiver = { signedAt: string; byGuardian: boolean } | null;

export function WaiverBadge({ waiver, required }: { waiver: Waiver; required: boolean }) {
  if (!required) return <span className="text-[11px] text-muted-foreground">No waiver</span>;
  return waiver ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[11px] font-bold text-lime">
      <Check className="h-3 w-3" /> Signed{waiver.byGuardian ? " by guardian" : ""}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-coral/15 px-2 py-0.5 text-[11px] font-bold text-coral">
      <X className="h-3 w-3" /> Not signed
    </span>
  );
}
