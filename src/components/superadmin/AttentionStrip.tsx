import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { superadminAttention } from "@/lib/superadmin-attention.functions";

type Item =
  | { key: string; label: string; tab: string }
  | { key: string; label: string; to: "/admin/moderation" };

const ITEMS = [
  // The moderation queue opens on its "New" filter, which is what this chip counts.
  // The Content tab's Reports list has no status filter, so the chip does not go there.
  { key: "newReports", label: "New reports", to: "/admin/moderation" },
  { key: "birthdayCorrections", label: "Birthday corrections", tab: "youth" },
  { key: "guardianRequests", label: "Guardian requests", tab: "youth" },
  { key: "ageReviews", label: "Age reviews", tab: "youth" },
  { key: "pendingClaims", label: "Pending claims", tab: "listings" },
  { key: "legalDrafts", label: "Legal drafts", tab: "legal" },
  { key: "stuckReels", label: "Reels needing help", tab: "reels" },
] as const satisfies readonly Item[];

/** Counts for every unified queue; each chip jumps to the tab or page that handles it. */
export function AttentionStrip({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const load = useServerFn(superadminAttention);
  const { data } = useQuery({
    queryKey: ["superadmin-attention"],
    queryFn: () => load(),
    refetchInterval: 60_000,
  });
  if (!data) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {ITEMS.map((i) => {
        const n = data[i.key];
        const variant = n > 0 ? "default" : "outline";
        const text = `${i.label}: ${n}`;
        if ("to" in i)
          return (
            <Button key={i.key} size="sm" variant={variant} asChild>
              <Link to={i.to}>{text}</Link>
            </Button>
          );
        return (
          <Button key={i.key} size="sm" variant={variant} onClick={() => onNavigate(i.tab)}>
            {text}
          </Button>
        );
      })}
    </div>
  );
}
