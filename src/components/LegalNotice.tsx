import { ShieldAlert } from "lucide-react";

export function LegalNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        BallaCity does not process payments, hold funds, or act as an escrow. All payments go
        directly between you and the host. Verify recipient details before sending.
      </p>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 text-xs leading-relaxed text-muted-foreground">
      <div className="flex items-center gap-2 text-foreground font-semibold mb-1.5">
        <ShieldAlert className="h-4 w-4 text-coral" />
        Peer-to-peer payment notice
      </div>
      <ul className="space-y-1 list-disc pl-4">
        <li>BallaCity does not process payments.</li>
        <li>All payments are sent directly between players and hosts.</li>
        <li>BallaCity does not hold funds, provide escrow, or act as a payment processor.</li>
        <li>You are responsible for verifying payment information before sending funds.</li>
      </ul>
    </div>
  );
}
