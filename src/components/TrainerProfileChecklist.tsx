import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, ChevronRight } from "lucide-react";
import type { Org } from "@/lib/sample-data";

/**
 * Post-create checklist surfaced at the top of the trainer profile
 * for owners with incomplete setup. Each item deep-links into the
 * edit route.
 */
export function TrainerProfileChecklist({ org }: { org: Org }) {
  const items = [
    {
      key: "cover",
      label: "Add a cover photo",
      done: !!org.cover && !org.cover.includes("default"),
    },
    {
      key: "bio",
      label: "Write a detailed bio (100+ chars)",
      done: (org.bio?.trim().length ?? 0) >= 100,
    },
    {
      key: "venues",
      label: "Add extra venue locations",
      done: (org.venueAddresses?.length ?? 0) > 1,
    },
    {
      key: "availability",
      label: "Set recurring availability rules",
      done: (org.availabilityRules?.length ?? 0) > 0,
    },
    { key: "achievements", label: "Add achievements", done: (org.achievements?.length ?? 0) > 0 },
    { key: "credentials", label: "Add credentials", done: (org.credentials?.length ?? 0) > 0 },
  ];

  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;

  const pct = Math.round((doneCount / items.length) * 100);

  return (
    <div className="rounded-3xl border border-lime/30 bg-lime/5 p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="section-eyebrow text-lime">Complete your profile</div>
          <div className="text-[11px] text-muted-foreground">
            {doneCount} of {items.length} done · {pct}%
          </div>
        </div>
        <Link
          to="/trainers/$trainerId/edit"
          params={{ trainerId: org.id }}
          className="inline-flex items-center gap-1 text-xs font-bold text-lime hover:underline"
        >
          Continue <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden mb-3">
        <div className="h-full bg-lime-gradient transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-sm">
            {item.done ? (
              <CheckCircle2 className="h-4 w-4 text-lime shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className={item.done ? "text-muted-foreground line-through" : ""}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
