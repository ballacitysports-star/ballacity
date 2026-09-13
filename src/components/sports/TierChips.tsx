import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { submenuParentForTier, type SportScale } from "@/lib/sport-levels";

/**
 * Shared sport-tier chip list used everywhere a player picks levels (profile
 * editor, filters, game creation/edit). Renders a scale's groups and flat
 * tiers, and expands a submenu of child tiers behind a parent chip when the
 * scale defines `submenus` (e.g. Rec League → Tee Ball, Minors, Majors…).
 *
 * Submenu children are normal tiers for storage and filtering — this
 * component only changes how they are presented.
 */
export function TierChips({
  scale,
  selected,
  onToggle,
  size = "sm",
  leading,
  ariaPrefix,
}: {
  scale: SportScale;
  /** Currently selected flat tier strings. */
  selected: string[];
  onToggle: (tier: string) => void;
  /** "lg" matches the big pill style used on game create/edit. */
  size?: "sm" | "lg";
  /** Optional chip rendered before the tiers (e.g. an "All Levels" chip). */
  leading?: ReactNode;
  /** Prefix for chip aria-labels, e.g. the sport name. */
  ariaPrefix?: string;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        selected.map((t) => submenuParentForTier(scale, t)).filter((p): p is string => Boolean(p)),
      ),
  );
  const submenus = scale.submenus ?? {};
  const childTiers = new Set(Object.values(submenus).flat());

  const toggleExpanded = (parent: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });

  const isOpen = (parent: string) =>
    expanded.has(parent) ||
    selected.includes(parent) ||
    (submenus[parent] ?? []).some((c) => selected.includes(c));

  const chipClass = (active: boolean) =>
    size === "lg"
      ? `shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
          active
            ? "border-lime bg-lime text-primary-foreground"
            : "border-border bg-surface text-muted-foreground"
        }`
      : `rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
          active
            ? "border-lime bg-lime/15 text-lime"
            : "border-border bg-background text-muted-foreground hover:border-lime/40 hover:text-foreground"
        }`;

  const chip = (tier: string, groupLabel?: string): ReactNode => {
    if (childTiers.has(tier)) return null; // children render under their parent
    const active = selected.includes(tier);
    const label =
      groupLabel && tier.startsWith(`${groupLabel} `) ? tier.slice(groupLabel.length + 1) : tier;
    const children = submenus[tier];
    return (
      <span key={tier} className="inline-flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={active}
          aria-label={ariaPrefix ? `${ariaPrefix} ${tier}` : tier}
          onClick={() => onToggle(tier)}
          className={chipClass(active)}
        >
          {label}
        </button>
        {children && (
          <>
            <button
              type="button"
              aria-expanded={isOpen(tier)}
              aria-label={`${label} divisions`}
              onClick={() => toggleExpanded(tier)}
              className="grid h-6 w-6 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-lime/40 hover:text-foreground"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${isOpen(tier) ? "rotate-180" : ""}`}
              />
            </button>
            {isOpen(tier) &&
              children.map((child) => {
                const childActive = selected.includes(child);
                return (
                  <button
                    key={child}
                    type="button"
                    aria-pressed={childActive}
                    aria-label={ariaPrefix ? `${ariaPrefix} ${child}` : child}
                    onClick={() => onToggle(child)}
                    className={`${chipClass(childActive)} border-dashed`}
                  >
                    {child}
                  </button>
                );
              })}
          </>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-2">
      {scale.groups ? (
        scale.groups.map((g) => (
          <div key={g.label}>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              {g.label}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {g.tiers.map((t) => chip(t, g.label))}
            </div>
          </div>
        ))
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {leading}
          {scale.tiers.map((t) => chip(t))}
        </div>
      )}
      {scale.hint && <p className="text-[10px] text-muted-foreground">{scale.hint}</p>}
    </div>
  );
}
