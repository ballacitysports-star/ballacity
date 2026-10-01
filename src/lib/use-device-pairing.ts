import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createDevicePairing, revokeDevicePairing } from "@/lib/device-pairing.functions";
import type { DevicePairingRow } from "@/lib/device-pairing";

function queryKey(childUserId: string) {
  return ["device-pairing", childUserId] as const;
}

/**
 * The one pairing row (or none) for this child — read directly, the same way
 * account-type.ts reads profiles.account_type: RLS on managed_device_pairings
 * already scopes SELECT to the managing guardian, so no server fn is needed
 * for a plain read.
 */
export function useDevicePairingStatus(childUserId: string | null | undefined) {
  return useQuery({
    queryKey: queryKey(childUserId ?? "none"),
    enabled: !!childUserId,
    staleTime: 10_000,
    queryFn: async (): Promise<DevicePairingRow | null> => {
      const { data, error } = await supabase
        .from("managed_device_pairings")
        .select("status, device_label, paired_at, expires_at")
        .eq("child_user_id", childUserId!)
        .eq("status", "linked")
        .maybeSingle();
      // A missing table (not yet migrated) reads the same as "not paired".
      if (error || !data) return null;
      const r = data as {
        status: "linked" | "revoked";
        device_label: string | null;
        paired_at: string | null;
        expires_at: string;
      };
      return {
        status: r.status,
        deviceLabel: r.device_label,
        pairedAt: r.paired_at,
        expiresAt: r.expires_at,
      };
    },
  });
}

export function useCreateDevicePairing() {
  const fn = useServerFn(createDevicePairing);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { childUserId: string; deviceLabel?: string }) => fn({ data: input }),
    onSuccess: (_result, input) => {
      void qc.invalidateQueries({ queryKey: queryKey(input.childUserId) });
    },
  });
}

export function useRevokeDevicePairing() {
  const fn = useServerFn(revokeDevicePairing);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { childUserId: string }) => fn({ data: input }),
    onSuccess: (_result, input) => {
      void qc.invalidateQueries({ queryKey: queryKey(input.childUserId) });
    },
  });
}
