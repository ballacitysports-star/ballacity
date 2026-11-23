import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  cancelManagedHandover,
  startManagedHandover,
  type StartedHandover,
} from "@/lib/managed-handover.functions";
import { parseManagedHandovers, type ManagedHandoverInfo } from "@/lib/managed-handover";

const KEY = "managed-handovers";

/**
 * Which of the signed-in guardian's managed accounts can be handed over, and which already have a handover waiting
 * (guardian_managed_handovers). Any failure reads as "none": if the migration is not applied yet, or the call fails, the
 * Parent Center simply does not offer the handover (fail closed). Only the managing guardian gets rows.
 */
export function useManagedHandovers() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [KEY, user?.id ?? "anon"],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<ManagedHandoverInfo[]> => {
      const { data, error } = await supabase.rpc("guardian_managed_handovers" as never);
      if (error) return [];
      return parseManagedHandovers(data);
    },
  });
}

export function useStartManagedHandover() {
  const fn = useServerFn(startManagedHandover);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { childUserId: string; email: string }): Promise<StartedHandover> =>
      fn({ data: { ...input, attested: true } }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}

export function useCancelManagedHandover() {
  const fn = useServerFn(cancelManagedHandover);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { childUserId: string }) => fn({ data: input }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}
