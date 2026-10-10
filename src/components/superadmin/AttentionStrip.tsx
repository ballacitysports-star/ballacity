import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { superadminAttention } from "@/lib/superadmin-attention.functions";

const ITEMS = [
  { key: "birthdayCorrections", label: "Birthday corrections", tab: "youth" },
  { key: "guardianRequests", label: "Guardian requests", tab: "youth" },
  { key: "ageReviews", label: "Age reviews", tab: "youth" },
  { key: "pendingClaims", label: "Pending claims", tab: "listings" },
  { key: "legalDrafts", label: "Legal drafts", tab: "legal" },
  { key: "stuckReels", label: "Reels needing help", tab: "reels" },
] as const;

/** Counts for every unified queue; each chip jumps to the tab that handles it. */
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
        return (
          <Button
            key={i.key}
            size="sm"
            variant={n > 0 ? "default" : "outline"}
            onClick={() => onNavigate(i.tab)}
          >
            {i.label}: {n}
          </Button>
        );
      })}
    </div>
  );
}
