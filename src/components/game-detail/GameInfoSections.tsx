import { MapPin, Navigation } from "lucide-react";
import { OpenInMaps } from "@/components/OpenInMaps";
import { VenueHostedAt } from "@/components/venue/VenueBadge";
import { type Game } from "@/lib/sample-data";
import { Wallet } from "lucide-react";
import { refundTermsDisplay, type RefundTerms } from "@/lib/refund-policy";
import { type GamePaymentSettings } from "@/lib/payments";

export type GameLocationCardProps = {
  game: Game;
};

export function GameLocationCard({ game }: GameLocationCardProps) {
  return (
    <>
      {/* Location card */}
      <div className="rounded-3xl border border-border bg-surface overflow-hidden">
        <div
          className="h-32 relative"
          style={{
            background:
              "radial-gradient(50% 60% at 50% 50%, oklch(0.30 0.08 145 / 0.5), transparent 60%), linear-gradient(180deg, oklch(0.18 0.03 240), oklch(0.14 0.03 250))",
          }}
        >
          <svg className="absolute inset-0 h-full w-full opacity-30" aria-hidden>
            <defs>
              <pattern id="g2" width="32" height="32" patternUnits="userSpaceOnUse">
                <path
                  d="M 32 0 L 0 0 0 32"
                  fill="none"
                  stroke="oklch(1 0 0 / 0.1)"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#g2)" />
          </svg>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-lime text-primary-foreground glow-lime">
            <MapPin className="h-5 w-5" />
          </div>
        </div>
        <OpenInMaps address={[game.location, game.neighborhood].filter(Boolean).join(", ")}>
          <div className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold underline-offset-2 hover:underline">
                {game.location}
              </div>
              <div className="text-sm text-muted-foreground">
                {game.neighborhood} · {game.indoor ? "Indoor" : "Outdoor"}
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-lime/15 px-3 py-1 text-xs font-semibold text-lime">
              <Navigation className="h-3.5 w-3.5" /> Directions
            </span>
          </div>
        </OpenInMaps>
        <VenueHostedAt orgId={game.orgId} />
      </div>
    </>
  );
}

export type GamePaymentTermsProps = {
  game: Game;
  isPaid: boolean;
  refundTerms: RefundTerms | null;
  settings: GamePaymentSettings | null;
};

export function GamePaymentTerms({ game, isPaid, refundTerms, settings }: GamePaymentTermsProps) {
  return (
    <>
      {/* Payment settings summary */}
      {(isPaid ||
        settings?.payment_deadline ||
        settings?.refund_policy ||
        settings?.payment_instructions) && (
        <div className="rounded-3xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="h-4 w-4 text-lime" />
            <h2 className="section-eyebrow text-muted-foreground">Payment settings</h2>
          </div>
          <div className="space-y-3">
            {settings?.payment_deadline && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Payment deadline</div>
                <div className="text-sm font-semibold">
                  {new Date(settings.payment_deadline).toLocaleString()}
                </div>
              </div>
            )}
            {isPaid && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Refund policy</div>
                {(() => {
                  const display = refundTermsDisplay(refundTerms, game.cancelCutoffMin);
                  if (!display)
                    return (
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        The host hasn't posted refund terms yet.
                      </p>
                    );
                  return (
                    <>
                      <p className="text-sm leading-relaxed">{display.summary}</p>
                      {display.hostNote && (
                        <p className="mt-1 text-sm leading-relaxed">
                          <span className="font-semibold">Host's note: </span>
                          {display.hostNote}
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
            {settings?.payment_instructions && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Payment instructions</div>
                <p className="text-sm leading-relaxed">{settings.payment_instructions}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
