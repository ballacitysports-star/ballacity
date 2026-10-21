import { INTENT_LABEL, parseIntents } from "@/lib/availability-levels";

/** "Guest player" / "Trying out" pills for an availability post. */
export function AvailabilityIntentBadges({ value, className = "" }: { value: unknown; className?: string }) {
  const intents = parseIntents(value);
  if (intents.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {intents.map((intent) => (
        <span
          key={intent}
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            intent === "tryout" ? "bg-sky-500/15 text-sky-500" : "bg-lime/15 text-lime"
          }`}
        >
          {INTENT_LABEL[intent]}
        </span>
      ))}
    </span>
  );
}
