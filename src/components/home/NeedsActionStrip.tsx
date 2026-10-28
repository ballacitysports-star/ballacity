import { Link } from "@tanstack/react-router";
import { CalendarClock, ChevronRight, MessageCircle, UserCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { FamilyInboxSection } from "@/components/child/FamilyInboxSection";
import { useNeedsAction } from "@/lib/use-needs-action";
import type { NeedsActionItem } from "@/lib/needs-action";

const ICONS: Record<NeedsActionItem["id"], typeof UserCheck> = {
  "host-requests": UserCheck,
  today: CalendarClock,
  messages: MessageCircle,
};

/**
 * Top of the feed: what is waiting on the member, and nothing else. It renders
 * nothing when nothing is waiting (and while it is still finding out), so the
 * feed stays the first thing anyone sees. A parent's approvals sit above it.
 */
export function NeedsActionStrip({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className={className}>
      <FamilyInboxSection className="mb-3" />
      <Items />
    </div>
  );
}

function Items() {
  const { items } = useNeedsAction();
  if (items.length === 0) return null;
  return (
    <section aria-label="Needs your attention" className="mb-4">
      <h2 className="section-eyebrow mb-2 text-muted-foreground">Needs you now</h2>
      <ul className="space-y-2">
        {items.map((item) => {
          const Icon = ICONS[item.id];
          return (
            <li key={item.id}>
              <Link
                to={item.to as never}
                params={item.params as never}
                search={item.search as never}
                className={`flex min-h-11 items-center gap-3 rounded-2xl border p-3 ${
                  item.tone === "urgent"
                    ? "border-coral/40 bg-coral/10"
                    : "border-border bg-surface"
                }`}
              >
                <Icon
                  className={`h-5 w-5 shrink-0 ${item.tone === "urgent" ? "text-coral" : "text-lime"}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{item.label}</span>
                  {item.detail ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
