import { BadgeCheck, ShieldQuestion } from "lucide-react";
import { hostTrustStats, hostVerificationLabel, type HostTrust } from "@/lib/game-policy";

/**
 * Host trust info: games hosted, rating, attendance, and verification.
 * A verification badge renders ONLY when a real verification record exists.
 */
export function HostTrustPanel({
  trust,
  hostName,
  className = "",
}: {
  trust: HostTrust;
  hostName?: string;
  className?: string;
}) {
  const stats = hostTrustStats(trust);
  const verifiedLabel = hostVerificationLabel(trust);

  return (
    <section
      aria-label="Host trust information"
      className={`rounded-2xl border border-border bg-surface px-4 py-3 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {hostName ? `About ${hostName}` : "About the host"}
        </h3>
        {verifiedLabel ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
            <BadgeCheck className="h-3 w-3" aria-hidden /> {verifiedLabel}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
            <ShieldQuestion className="h-3 w-3" aria-hidden /> Not verified
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.id} className="rounded-xl bg-background/60 px-2.5 py-2">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {s.label}
            </dt>
            <dd className="mt-0.5 text-[13px] font-semibold leading-tight">{s.value}</dd>
            {s.hint && <dd className="text-[10px] text-muted-foreground">{s.hint}</dd>}
          </div>
        ))}
      </dl>

      {!verifiedLabel && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          ballaCity hasn't verified this host. Read the game policies and message the host with any
          questions before you commit.
        </p>
      )}
    </section>
  );
}
