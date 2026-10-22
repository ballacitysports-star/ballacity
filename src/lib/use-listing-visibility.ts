import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { setListingHidden } from "@/lib/listing-visibility.functions";
import {
  LISTING_TABLE,
  visibilityOf,
  type ListingKind,
  type ListingVisibility,
} from "@/lib/listing-visibility";

const key = (kind: ListingKind, id: string) => ["listing-visibility", kind, id] as const;

/**
 * Whether the signed-in viewer's own listing is hidden, and by whom. Only the
 * people allowed to see a hidden row can read these columns, so for anyone else
 * the query finds nothing and the toggle stays out of the way.
 */
export function useListingVisibility(kind: ListingKind, id: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: key(kind, id),
    enabled: enabled && !!user && !!id,
    staleTime: 15_000,
    queryFn: async (): Promise<ListingVisibility | null> => {
      // The generated types predate these columns.
      const { data, error } = await supabase
        .from(LISTING_TABLE[kind] as never)
        .select("owner_hidden_at, moderator_hidden_at")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      return visibilityOf(
        data as { owner_hidden_at?: string | null; moderator_hidden_at?: string | null },
      );
    },
  });
}

/** Hide or show, then refresh what the page knows. */
export function useSetListingHidden(kind: ListingKind, id: string) {
  const qc = useQueryClient();
  const call = useServerFn(setListingHidden);
  return useMutation({
    mutationFn: (hidden: boolean) => call({ data: { kind, id, hidden } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(kind, id) });
      void qc.invalidateQueries({ queryKey: ["hidden-listings"] });
      // Lists that show this listing to others.
      void qc.invalidateQueries({ queryKey: ["team-posts"] });
      void qc.invalidateQueries({ queryKey: ["public-team"] });
      void qc.invalidateQueries({ queryKey: ["public-trainer"] });
    },
  });
}
