import { Check, Clock, CreditCard, Hourglass, ShieldCheck, X } from "lucide-react";
import { FLOW_META, type FlowTone, type PlayerFlowStatus } from "@/lib/game-flow-status";

const TONE_CLASS: Record<FlowTone, string> = {
  muted: "border-border bg-surface text-muted-foreground",
  info: "border-lime/40 bg-lime/10 text-lime",
  warning: "border-coral/50 bg-coral/10 text-coral",
  success: "border-lime/50 bg-lime/15 text-lime",
  destructive: "border-destructive/50 bg-destructive/10 text-destructive",
};

const ICONS: Record<PlayerFlowStatus, React.ReactNode> = {
  none: null,
  requested: <Hourglass className="h-3 w-3" />,
  approved: <Check className="h-3 w-3" />,
  payment_pending: <CreditCard className="h-3 w-3" />,
  payment_submitted: <Clock className="h-3 w-3" />,
  payment_rejected: <X className="h-3 w-3" />,
  payment_verified: <ShieldCheck className="h-3 w-3" />,
  confirmed: <Check className="h-3 w-3" />,
  rejected: <X className="h-3 w-3" />,
};

export function PlayerFlowPill({
  status,
  size = "sm",
  short = false,
  className = "",
}: {
  status: PlayerFlowStatus;
  size?: "xs" | "sm";
  short?: boolean;
  className?: string;
}) {
  if (status === "none") return null;
  const meta = FLOW_META[status];
  const sizeClass = size === "xs" ? "text-[10px] px-1.5 py-0.5 gap-1" : "text-xs px-2 py-0.5 gap-1";
  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold whitespace-nowrap ${sizeClass} ${TONE_CLASS[meta.tone]} ${className}`}
      data-flow-status={status}
      title={meta.description}
      aria-label={meta.label}
    >
      {ICONS[status]}
      {short ? meta.short : meta.label}
    </span>
  );
}
